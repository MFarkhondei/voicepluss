// ذخیره‌سازی محلی پلی‌لیست (فایل صوتی + متن + آخرین موقعیت پخش) با IndexedDB
//
// طرح دیتابیس عمداً به دو Object Store جدا تقسیم شده: «meta» (متادیتا:
// نام، مدت، آخرین موقعیت پخش، متن، بخش‌ها) و «blobs» (فقط خود فایل صوتی).
// دلیل: در نسخهٔ قبلی هر دو در یک رکورد بودند، پس هر آپدیت کوچکِ متادیتا
// (مثلاً هر ۴ ثانیه ذخیرهٔ lastTime حین پخش، یا آپدیت duration/text/segments
// چند صد میلی‌ثانیه پس از باز شدن آیتم) مجبور بود کل رکورد را دوباره
// بخواند و بنویسد — یعنی فایل صوتی چند مگابایتی را هم هر بار دوباره
// serialize/clone و در IndexedDB بازنویسی می‌کرد. این کار سنگین درست در
// همان چند ثانیهٔ اول پخش انجام می‌شد و در فایرفاکس باعث تپق/توقف پخش
// می‌شد. با جدا کردن blob از متادیتا، آپدیت‌های متداول اصلاً به Blob
// دست نمی‌زنند.

export type LibrarySegment = {
  start: number;
  end: number;
  text: string;
  confidence?: number | null;
};

export type LibraryMeta = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  size: number;
  type: string;
  duration: number | null;
  lastTime: number;
  text: string;
  segments: LibrarySegment[];
};

export type LibraryItem = LibraryMeta & { blob: Blob };

const DB_NAME = "voicepluss";
const META_STORE = "meta";
const BLOB_STORE = "blobs";
const OLD_STORE = "library"; // نام Object Store در نسخهٔ قدیمی (تک‌جدولی)
const VERSION = 2;
const MAX_ITEMS = 20;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB در دسترس نیست"));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion || 0;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE, { keyPath: "id" });
      }
      // مهاجرت از طرح قدیمی (نسخهٔ ۱): یک رکورد ترکیبی در «library».
      // نکتهٔ مهم: حذف Store قدیمی باید بعد از اتمام کامل کپی (وقتی cursor
      // به آخر می‌رسد) انجام شود — حذف زودهنگام باعث می‌شد مهاجرت ناقص
      // بماند و پلی‌لیست قبلی کاربر خالی به نظر برسد.
      if (oldVersion < 2 && db.objectStoreNames.contains(OLD_STORE)) {
        const migTx = req.transaction;
        if (migTx) {
          const oldStore = migTx.objectStore(OLD_STORE);
          const metaStore = migTx.objectStore(META_STORE);
          const blobStore = migTx.objectStore(BLOB_STORE);
          const cursorReq = oldStore.openCursor();
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor) {
              db.deleteObjectStore(OLD_STORE);
              return;
            }
            const old = cursor.value as LibraryItem;
            const { blob, ...meta } = old;
            metaStore.put(meta);
            if (blob) blobStore.put({ id: old.id, blob });
            cursor.continue();
          };
        } else {
          db.deleteObjectStore(OLD_STORE);
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("خطا در باز کردن حافظه"));
  });
}

/** یک تراکنش روی یک یا چند Object Store اجرا می‌کند.
 * fn می‌تواند صفر یا چند درخواست (put/delete/...) صادر کند و به‌صورت اختیاری
 * آخرین IDBRequest را برای گرفتن مقدار برگشتی برگرداند (مثلاً get/getAll).
 * حل‌شدن Promise همیشه با اتمام کامل تراکنش (oncomplete) هماهنگ است، نه با
 * موفقیت تک‌تک درخواست‌ها؛ این‌طور چند put هم‌زمان (مثلاً روی meta و blobs) هم
 * درست resolve می‌شوند. */
function tx<T = void>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  fn: (stores: Record<string, IDBObjectStore>) => IDBRequest<T> | void,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const names = Array.isArray(storeNames) ? storeNames : [storeNames];
        const t = db.transaction(names, mode);
        const stores: Record<string, IDBObjectStore> = {};
        for (const n of names) stores[n] = t.objectStore(n);
        let value: T | undefined;
        const result = fn(stores);
        if (result) {
          result.onsuccess = () => {
            value = result.result;
          };
          result.onerror = () => reject(result.error ?? new Error("خطای حافظه"));
        }
        t.oncomplete = () => {
          db.close();
          resolve(value as T);
        };
        t.onerror = () => reject(t.error ?? new Error("خطای حافظه"));
      }),
  );
}

export function makeLibraryId() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

export async function listLibrary(): Promise<LibraryMeta[]> {
  try {
    const all = await tx<LibraryMeta[]>(
      META_STORE,
      "readonly",
      (s) => s[META_STORE].getAll() as IDBRequest<LibraryMeta[]>,
    );
    return (all || []).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function getLibraryItem(id: string): Promise<LibraryItem | null> {
  try {
    const [meta, blobRec] = await Promise.all([
      tx<LibraryMeta | undefined>(
        META_STORE,
        "readonly",
        (s) => s[META_STORE].get(id) as IDBRequest<LibraryMeta | undefined>,
      ),
      tx<{ id: string; blob: Blob } | undefined>(
        BLOB_STORE,
        "readonly",
        (s) => s[BLOB_STORE].get(id) as IDBRequest<{ id: string; blob: Blob } | undefined>,
      ),
    ]);
    if (!meta || !blobRec) return null;
    return { ...meta, blob: blobRec.blob };
  } catch {
    return null;
  }
}

export async function putLibraryItem(item: LibraryItem): Promise<void> {
  try {
    const { blob, ...meta } = item;
    await tx([META_STORE, BLOB_STORE], "readwrite", (s) => {
      s[META_STORE].put(meta);
      s[BLOB_STORE].put({ id: item.id, blob });
    });
    await pruneLibrary();
  } catch {
    /* ignore */
  }
}

/** فقط متادیتا را آپدیت می‌کند — هرگز Blob فایل صوتی را دوباره نمی‌خواند/نمی‌نویسد. */
export async function updateLibraryItem(
  id: string,
  patch: Partial<Omit<LibraryMeta, "id">>,
): Promise<void> {
  try {
    const existing = await tx<LibraryMeta | undefined>(
      META_STORE,
      "readonly",
      (s) => s[META_STORE].get(id) as IDBRequest<LibraryMeta | undefined>,
    );
    if (!existing) return;
    await tx(META_STORE, "readwrite", (s) => {
      s[META_STORE].put({ ...existing, ...patch, updatedAt: Date.now() });
    });
  } catch {
    /* ignore */
  }
}

export async function deleteLibraryItem(id: string): Promise<void> {
  try {
    await tx([META_STORE, BLOB_STORE], "readwrite", (s) => {
      s[META_STORE].delete(id);
      s[BLOB_STORE].delete(id);
    });
  } catch {
    /* ignore */
  }
}

async function pruneLibrary() {
  const metas = await listLibrary();
  const extra = metas.slice(MAX_ITEMS);
  for (const m of extra) await deleteLibraryItem(m.id);
}

export function formatLibraryDate(ts: number) {
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ts));
  } catch {
    return "";
  }
}
