const CHUNK_SIZE = 24 * 1024 * 1024; // 24 MiB

function generateId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

export async function uploadFileInChunks(
  file: File,
  onProgress?: (p: number) => void,
  uploadApiBase?: string
) {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const sessionId = generateId();
  const apiBase = uploadApiBase || (import.meta.env.VITE_UPLOAD_API_URL as string) || '/api';

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);

    await uploadChunk(chunk, {
      sessionId,
      filename: file.name,
      index: i,
      total: totalChunks,
    }, (uploadedBytes) => {
      if (onProgress) {
        const overall = (i * CHUNK_SIZE + uploadedBytes) / file.size;
        onProgress(Math.min(1, overall));
      }
    }, apiBase);
  }

  // optionally poll server for assembly/transcribe
  return { sessionId, totalChunks };
}

async function uploadChunk(
  chunk: Blob,
  meta: { sessionId: string; filename: string; index: number; total: number },
  onChunkProgress?: (uploaded: number) => void,
  apiBase?: string
) {
  const form = new FormData();
  form.append('chunk', chunk);
  form.append('sessionId', meta.sessionId);
  form.append('filename', meta.filename);
  form.append('index', String(meta.index));
  form.append('total', String(meta.total));

  const resp = await fetch((apiBase || '/api') + '/upload-chunk', {
    method: 'POST',
    body: form,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`upload failed: ${resp.status} ${text}`);
  }
  return resp.json();
}

export { CHUNK_SIZE };
