import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

const upload = multer({ dest: osTmp() });
const app = express();
const PORT = process.env.PORT || 4001;
const STORAGE_ROOT = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');

fs.mkdirSync(STORAGE_ROOT, { recursive: true });

function osTmp() {
  return process.env.TMPDIR || process.env.TEMP || '/tmp';
}

app.post('/api/upload-chunk', upload.single('chunk'), async (req, res) => {
  try {
    const { sessionId, filename, index, total } = req.body as any;
    if (!sessionId || !filename || index == null || total == null) {
      return res.status(400).json({ error: 'missing metadata' });
    }
    const sessionDir = path.join(STORAGE_ROOT, sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });
    const partPath = path.join(sessionDir, String(index));
    // move file
    const file = (req.file as any);
    if (!file) return res.status(400).json({ error: 'no chunk file' });
    fs.renameSync(file.path, partPath);

    // check if all parts present
    const files = fs.readdirSync(sessionDir);
    if (files.length === Number(total)) {
      const assembled = path.join(sessionDir, filename);
      // try ffmpeg concat first
      const useFfmpeg = Boolean(ffmpegPath);
      if (useFfmpeg) {
        const partsList = files
          .map((f) => `file '${path.join(sessionDir, f).replace(/'/g, "'\\''")}'`)
          .join('\n');
        const listPath = path.join(sessionDir, 'parts.txt');
        fs.writeFileSync(listPath, partsList);
        const out = assembled;
        // ffmpeg -f concat -safe 0 -i parts.txt -c copy out
        await runFfmpegConcat(listPath, out);
      } else {
        // byte-concat
        const outStream = fs.createWriteStream(assembled);
        for (let i = 0; i < Number(total); i++) {
          const p = path.join(sessionDir, String(i));
          if (!fs.existsSync(p)) continue;
          const data = fs.readFileSync(p);
          outStream.write(data);
        }
        outStream.end();
      }
      return res.json({ status: 'assembled', path: assembled });
    }

    return res.json({ status: 'stored', index: Number(index) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server error', detail: String(err) });
  }
});

app.get('/api/upload-status', (req, res) => {
  const sessionId = String(req.query.sessionId || '');
  if (!sessionId) return res.status(400).json({ error: 'missing sessionId' });
  const sessionDir = path.join(STORAGE_ROOT, sessionId);
  if (!fs.existsSync(sessionDir)) return res.json({ status: 'not_found' });
  const files = fs.readdirSync(sessionDir);
  const assembled = files.find((f) => f !== 'parts.txt' && isNaN(Number(f)));
  if (assembled) {
    return res.json({ status: 'assembled', file: path.join(sessionDir, assembled) });
  }
  return res.json({ status: 'parts', parts: files });
});

app.listen(Number(PORT), () => {
  console.log(`Chunk upload server listening on port ${PORT}`);
});

function runFfmpegConcat(listPath: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ff = ffmpegPath || 'ffmpeg';
    const args = ['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath];
    const proc = spawn(ff, args, { stdio: 'inherit' });
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error('ffmpeg exited with code ' + code));
    });
    proc.on('error', (err) => reject(err));
  });
}
