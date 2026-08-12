// ذخیره‌سازی محلی پلی‌لیست (فایل صوتی + متن + آخرین موقعیت پخش) با IndexedDB

export type LibrarySegment = {
  start: number;
  end: number;
  text: string;
  confidence?: number | null;
};

export type LibraryItem = {
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
  blob: Blob;
};

export type LibraryMeta = Omit<LibraryItem, "blob">;

const DB_NAME = "voicepluss";
const STORE = "library";
const VERSION = 1;
const MAX_ITEMS = 20;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB در دسترس نیست"));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("خطا در باز کردن حافظه"));
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("خطای حافظه"));
        t.oncomplete = () => db.close();
      }),
  );
}

export function makeLibraryId() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

export async function listLibrary(): Promise<LibraryMeta[]> {
  try {
    const all = await tx<LibraryItem[]>("readonly", (s) => s.getAll() as IDBRequest<LibraryItem[]>);
    return all
      .map(({ blob: _blob, ...meta }) => meta)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function getLibraryItem(id: string): Promise<LibraryItem | null> {
  try {
    const item = await tx<LibraryItem | undefined>("readonly", (s) => s.get(id) as IDBRequest<LibraryItem | undefined>);
    return item ?? null;
  } catch {
    return null;
  }
}

export async function putLibraryItem(item: LibraryItem): Promise<void> {
  try {
    await tx("readwrite", (s) => s.put(item) as IDBRequest<IDBValidKey>);
    await pruneLibrary();
  } catch {
    /* ignore */
  }
}

export async function updateLibraryItem(
  id: string,
  patch: Partial<Omit<LibraryItem, "id" | "blob">>,
): Promise<void> {
  try {
    const existing = await getLibraryItem(id);
    if (!existing) return;
    await tx("readwrite", (s) => s.put({ ...existing, ...patch, updatedAt: Date.now() }) as IDBRequest<IDBValidKey>);
  } catch {
    /* ignore */
  }
}

export async function deleteLibraryItem(id: string): Promise<void> {
  try {
    await tx("readwrite", (s) => s.delete(id) as IDBRequest<undefined>);
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
