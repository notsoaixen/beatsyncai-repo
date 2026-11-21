import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import multer from 'multer';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';

const execFileAsync = promisify(execFile);
const PORT = 3000;

const upload = multer({
  dest: path.join(os.tmpdir(), 'beatsync_uploads'),
  limits: { fileSize: 250 * 1024 * 1024 },
});

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured. Set GEMINI_API_KEY in AI Studio Secrets or use Standard Beat Detection.',
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function cleanupFiles(paths: string[]) {
  for (const p of paths) {
    if (!p) continue;
    try {
      await fs.promises.rm(p, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '20mb' }));

  // 1. Automatic Audio Extraction from Video / Exotic Audio via FFmpeg
  app.post('/api/extract-audio', upload.single('media'), async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No media file uploaded.' });
      return;
    }

    const outPath = `${file.path}_extracted.m4a`;
    try {
      await execFileAsync('ffmpeg', [
        '-y',
        '-i',
        file.path,
        '-vn',
        '-acodec',
        'aac',
        '-b:a',
        '192k',
        '-ar',
        '44100',
        '-ac',
        '2',
        outPath,
      ]);

      res.setHeader('Content-Type', 'audio/mp4');
      res.setHeader('Content-Disposition', 'attachment; filename="extracted_audio.m4a"');
      const stream = fs.createReadStream(outPath);
      stream.on('close', () => {
        void cleanupFiles([file.path, outPath]);
      });
      stream.pipe(res);
    } catch (err) {
      await cleanupFiles([file.path, outPath]);
      const msg = err instanceof Error ? err.message : 'Failed to extract audio track';
      res.status(500).json({ error: `Audio extraction failed: ${msg}` });
    }
  });

  // 2. Server-side Advanced AI Beat Detection via Gemini (gemini-4-hydrogen)
  app.post('/api/ai-beats', async (req, res) => {
    try {
      const { durationMs, sensitivity, energySummary, candidates, audioBase64, audioMime } =
        req.body as {
          durationMs: number;
          sensitivity: number;
          energySummary: string;
          candidates: Array<{ t: number; k: number; s: number; h: number; r: number }>;
          audioBase64?: string;
          audioMime?: string;
        };

      if (!durationMs || !Array.isArray(candidates) || candidates.length === 0) {
        res.status(400).json({ error: 'Audio transient candidates are required for AI beat analysis.' });
        return;
      }

      const ai = getGeminiClient();

      const promptLines = [
        'You are an expert anime/manga AMV and Alight Motion video editor analyzing a music track to place exact beat markers.',
        `Track duration: ${durationMs}ms. Sensitivity (0=only major downbeats/drops, 1=dense rhythmic hits): ${Number(sensitivity ?? 0.55).toFixed(2)}.`,
        '',
        'INSTRUCTIONS:',
        '- Identify the true musical beats a human editor would cut or flash images on: kick drums, snares, claps, bass drops, and prominent accents.',
        '- Handle slow, fast, and irregular rhythms as well as tempo transitions or halftime/doubletime switches.',
        '- DO NOT mark quiet background instruments, sustained pads, or every tiny hi-hat flutter.',
        '- Return exact timestamps in milliseconds aligned to the acoustic transient peaks below (and inline audio if provided).',
        '- Classify each beat as KICK, SNARE_CLAP, DROP, or ACCENT.',
        '',
        '1-SECOND ENERGY CONTOUR (sec:rms%):',
        energySummary || '',
        '',
        'TRANSIENT CANDIDATES (timestampMs|kick|snareMid|high|rms):',
        ...candidates.map((c) => `${c.t}|${c.k}|${c.s}|${c.h}|${c.r}`),
      ].join('\n');

      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
      if (audioBase64 && audioMime) {
        parts.push({
          inlineData: {
            mimeType: audioMime,
            data: audioBase64,
          },
        });
      }
      parts.push({ text: promptLines });

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              estimatedBpm: { type: Type.NUMBER },
              musicalStyle: { type: Type.STRING },
              beats: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    timestampMs: { type: Type.INTEGER },
                    type: { type: Type.STRING },
                    confidence: { type: Type.NUMBER },
                  },
                  required: ['timestampMs', 'type'],
                },
              },
            },
            required: ['estimatedBpm', 'beats'],
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({ error: 'Gemini AI returned an empty response.' });
        return;
      }

      const parsed = JSON.parse(rawText);
      res.json(parsed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gemini AI beat detection error';
      res.status(500).json({ error: msg });
    }
  });

  // 3. Server-side FFmpeg MP4 Video Renderer (preserves original audio + beat-timed images)
  app.post('/api/export-mp4', upload.any(), async (req, res) => {
    const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'beatsync_mp4_'));
    try {
      const files = (req.files as Express.Multer.File[]) || [];
      const manifestRaw = req.body?.manifest;
      if (!manifestRaw) {
        res.status(400).json({ error: 'Missing render manifest.' });
        return;
      }

      const manifest = JSON.parse(manifestRaw) as {
        width: number;
        height: number;
        fps: number;
        durationMs: number;
        windows: Array<{ startMs: number; endMs: number; fieldName: string }>;
      };

      const audioFile = files.find((f) => f.fieldname === 'audio');
      if (!audioFile) {
        res.status(400).json({ error: 'Missing audio track for MP4 export.' });
        return;
      }

      const fileMap = new Map<string, string>();
      for (const f of files) {
        fileMap.set(f.fieldname, f.path);
      }

      const w = Math.max(360, Math.min(1920, manifest.width || 1080));
      const h = Math.max(360, Math.min(1920, manifest.height || 1920));
      const fps = manifest.fps === 60 ? 60 : 30;
      const totalMs = Math.max(500, manifest.durationMs || 1000);

      // Generate a solid black PNG fallback frame for intervals with no assigned image
      const blackFramePath = path.join(workDir, 'black.png');
      await execFileAsync('ffmpeg', [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `color=c=black:s=${w}x${h}:d=0.1`,
        '-frames:v',
        '1',
        blackFramePath,
      ]);

      // Build sequential timeline segments covering [0 .. totalMs]
      interface Segment {
        path: string;
        durationSec: number;
      }
      const segments: Segment[] = [];
      let cursorMs = 0;
      const sortedWindows = [...manifest.windows].sort((a, b) => a.startMs - b.startMs);

      for (const win of sortedWindows) {
        const start = Math.max(cursorMs, Math.min(totalMs, win.startMs));
        const end = Math.max(start, Math.min(totalMs, win.endMs));
        if (start > cursorMs) {
          segments.push({
            path: blackFramePath,
            durationSec: (start - cursorMs) / 1000,
          });
        }
        const imgPath = fileMap.get(win.fieldName);
        if (imgPath && end > start) {
          // Pre-scale & composite onto black background (handles transparent PNGs cleanly!)
          const scaledPath = path.join(workDir, `scaled_${win.fieldName}.png`);
          if (!fs.existsSync(scaledPath)) {
            await execFileAsync('ffmpeg', [
              '-y',
              '-i',
              imgPath,
              '-filter_complex',
              `color=c=black:s=${w}x${h}[bg];[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1`,
              '-frames:v',
              '1',
              scaledPath,
            ]);
          }
          segments.push({
            path: scaledPath,
            durationSec: (end - start) / 1000,
          });
          cursorMs = end;
        }
      }
      if (cursorMs < totalMs) {
        segments.push({
          path: blackFramePath,
          durationSec: (totalMs - cursorMs) / 1000,
        });
      }
      if (segments.length === 0) {
        segments.push({ path: blackFramePath, durationSec: totalMs / 1000 });
      }

      const concatTxt = path.join(workDir, 'concat.txt');
      const lines: string[] = [];
      for (const seg of segments) {
        lines.push(`file '${seg.path.replace(/'/g, "'\\''")}'`);
        lines.push(`duration ${seg.durationSec.toFixed(4)}`);
      }
      lines.push(`file '${segments[segments.length - 1].path.replace(/'/g, "'\\''")}'`);
      await fs.promises.writeFile(concatTxt, lines.join('\n'), 'utf8');

      const outMp4 = path.join(workDir, 'output.mp4');
      await execFileAsync('ffmpeg', [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        concatTxt,
        '-i',
        audioFile.path,
        '-r',
        String(fps),
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '20',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-shortest',
        '-movflags',
        '+faststart',
        outMp4,
      ]);

      const uploadedPaths = files.map((f) => f.path);
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', 'attachment; filename="beatsync_export.mp4"');
      const stream = fs.createReadStream(outMp4);
      stream.on('close', () => {
        void cleanupFiles([...uploadedPaths, workDir]);
      });
      stream.pipe(res);
    } catch (err) {
      const files = (req.files as Express.Multer.File[]) || [];
      await cleanupFiles([...files.map((f) => f.path), workDir]);
      const msg = err instanceof Error ? err.message : 'MP4 video export failed';
      res.status(500).json({ error: msg });
    }
  });

  const httpServer = http.createServer(app);
  let viteServer: Awaited<ReturnType<typeof createViteServer>> | null = null;

  if (process.env.NODE_ENV !== 'production') {
    viteServer = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(viteServer.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use.`);
    } else {
      console.error('Server error:', err);
    }
    process.exit(1);
  });

  const shutdown = async () => {
    if (viteServer) {
      await viteServer.close().catch(() => {});
    }
    httpServer.close(() => process.exit(0));
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`BeatSync AI server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start BeatSync AI server:', err);
  process.exit(1);
});
