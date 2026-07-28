# Chunked Uploads (24 MiB)

این قابلیت به شما اجازه می‌دهد فایل‌های بزرگ را به قطعات 24MiB تقسیم کرده و روی سرور آپلود کنید، سپس سرور قطعات را به هم چسبانده و فایل نهایی را می‌سازد.

نصب و اجرا

1. نصب وابستگی‌ها

```bash
npm install
```

2. نصب ffmpeg (اختیاری اما توصیه‌شده برای فایل‌های صوت/ویدیو)

- روی macOS با Homebrew: `brew install ffmpeg`
- روی Ubuntu: `sudo apt install ffmpeg`

یا می‌توانید از بستهٔ `ffmpeg-static` که در dependencies قرار دارد استفاده کنید.

3. اجرای سرور آپلود (برای توسعه)

```bash
npm run dev:server
```

نحوه استفاده از کلاینت

در React کامپوننت `src/components/ChunkUploader.tsx` نمونه‌ای وجود دارد که از تابع `uploadFileInChunks` در `src/lib/chunkedUpload.ts` استفاده می‌کند.

محیط

می‌توانید URL API را با متغیر محیطی `VITE_UPLOAD_API_URL` مشخص کنید. پیش‌فرض `'/api'` است.

چگونگی ادغام

- اگر ffmpeg نصب باشد یا `ffmpeg-static` قابل دسترسی باشد، سرور از `ffmpeg -f concat` برای ادغام امن فایل‌ها استفاده می‌کند.
- در غیر این صورت فایل‌ها با concat بایت-به-بایت به هم چسبانده می‌شوند (برای بعضی فرمت‌ها این کار ممکن است خراب شدن header را به همراه داشته باشد).
