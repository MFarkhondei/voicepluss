import React, { useState } from 'react';
import { uploadFileInChunks } from '../lib/chunkedUpload';

export default function ChunkUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [status, setStatus] = useState<string>('');

  async function handleStart() {
    if (!file) return;
    setStatus('در حال آپلود...');
    try {
      const result = await uploadFileInChunks(file, (p) => setProgress(p));
      setStatus('آپلود کامل شد. sessionId: ' + result.sessionId);
    } catch (err: any) {
      setStatus('خطا: ' + (err?.message || String(err)));
    }
  }

  return (
    <div className="chunk-uploader">
      <label>
        انتخاب فایل:
        <input
          type="file"
          onChange={(e) => setFile(e.target.files ? e.target.files[0] : null)}
        />
      </label>
      <div style={{ marginTop: 8 }}>
        <button onClick={handleStart} disabled={!file}>
          شروع آپلود
        </button>
      </div>
      <div style={{ marginTop: 8 }}>
        <progress value={progress} max={1} style={{ width: '100%' }} />
        <div>{Math.round(progress * 100)}%</div>
      </div>
      <div style={{ marginTop: 8 }}>{status}</div>
    </div>
  );
}
