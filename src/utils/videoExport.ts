import { Capacitor } from '@capacitor/core';
import {
  BeatProject,
  ExportFps,
  ExportResolution,
  getResolutionDimensions,
  resolveBeatImageWindow,
} from '../types/beatsync';
import { resolveApiUrl } from './audioProcessor';

export async function exportProjectMp4(params: {
  project: BeatProject;
  resolution: ExportResolution;
  fps: ExportFps;
  onProgress: (message: string) => void;
}): Promise<Blob> {
  const { project, resolution, fps, onProgress } = params;
  if (!project.audioBlob) {
    throw new Error('Import an audio or video track before rendering MP4.');
  }

  const { width, height } = getResolutionDimensions(project.aspectRatio, resolution);
  const totalMs = Math.max(1000, project.durationMs);
  const sortedBeats = [...project.beats].sort((a, b) => a.timestampMs - b.timestampMs);
  const imageById = new Map(project.images.map((img) => [img.id, img]));

  // When running inside the native Android APK and offline (or if server unreachable),
  // try server FFmpeg first if online, with automatic on-device Canvas + MediaRecorder fallback!
  const formData = new FormData();
  formData.append('audio', project.audioBlob, 'audio_track.m4a');

  const fieldNameByImageId = new Map<string, string>();
  let imgCounter = 0;
  const windows: Array<{ startMs: number; endMs: number; fieldName: string }> = [];

  sortedBeats.forEach((beat, idx) => {
    if (!beat.assignedImageId) return;
    const img = imageById.get(beat.assignedImageId);
    if (!img) return;
    let fieldName = fieldNameByImageId.get(img.id);
    if (!fieldName) {
      fieldName = `img_${imgCounter++}`;
      fieldNameByImageId.set(img.id, fieldName);
      formData.append(fieldName, img.blob, img.name);
    }
    const { startMs, endMs } = resolveBeatImageWindow(sortedBeats, idx, totalMs);
    windows.push({
      startMs: Math.round(startMs),
      endMs: Math.round(endMs),
      fieldName,
    });
  });

  formData.append(
    'manifest',
    JSON.stringify({
      width,
      height,
      fps,
      durationMs: Math.round(totalMs),
      windows,
    }),
  );

  onProgress(`Rendering ${resolution} ${fps}fps MP4 with original audio...`);

  try {
    const resp = await fetch(resolveApiUrl('/api/export-mp4'), {
      method: 'POST',
      body: formData,
    });
    if (resp.ok) {
      return await resp.blob();
    }
    if (!Capacitor.isNativePlatform()) {
      const err = await resp.json().catch(() => ({ error: 'MP4 render failed' }));
      throw new Error(err.error || 'MP4 render failed');
    }
  } catch (err) {
    if (!Capacitor.isNativePlatform()) {
      throw err;
    }
  }

  // Offline on-device Android WebView fallback via Canvas + AudioContext + MediaRecorder
  onProgress('Offline render on device...');
  return renderOfflineCanvasVideo(project, width, height, fps, totalMs);
}

async function renderOfflineCanvasVideo(
  project: BeatProject,
  width: number,
  height: number,
  fps: number,
  totalMs: number,
): Promise<Blob> {
  if (!project.audioBlob) throw new Error('Missing audio');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');

  const sortedBeats = [...project.beats].sort((a, b) => a.timestampMs - b.timestampMs);
  const windows = sortedBeats
    .map((b, idx) => {
      if (!b.assignedImageId) return null;
      const { startMs, endMs } = resolveBeatImageWindow(sortedBeats, idx, totalMs);
      return { startMs, endMs, imageId: b.assignedImageId };
    })
    .filter((w): w is { startMs: number; endMs: number; imageId: string } => w !== null);

  const loadedImages = new Map<string, HTMLImageElement>();
  await Promise.all(
    project.images.map(
      (asset) =>
        new Promise<void>((resolve) => {
          const el = new Image();
          el.onload = () => {
            loadedImages.set(asset.id, el);
            resolve();
          };
          el.onerror = () => resolve();
          el.src = asset.objectUrl;
        }),
    ),
  );

  const audioCtx = new AudioContext();
  const decoded = await audioCtx.decodeAudioData(await project.audioBlob.arrayBuffer());
  const source = audioCtx.createBufferSource();
  source.buffer = decoded;
  const dest = audioCtx.createMediaStreamDestination();
  source.connect(dest);

  const videoStream = canvas.captureStream(fps);
  const combined = new MediaStream([
    ...videoStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);

  const mimeType =
    ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find(
      (m) => MediaRecorder.isTypeSupported(m),
    ) || 'video/webm';

  const recorder = new MediaRecorder(combined, {
    mimeType,
    videoBitsPerSecond: 6_000_000,
  });

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  return new Promise<Blob>((resolve, reject) => {
    let rafId = 0;
    const startPerf = performance.now();

    recorder.onstop = () => {
      cancelAnimationFrame(rafId);
      void audioCtx.close();
      resolve(new Blob(chunks, { type: mimeType }));
    };
    recorder.onerror = () => {
      cancelAnimationFrame(rafId);
      void audioCtx.close();
      reject(new Error('Offline video recording failed'));
    };

    recorder.start(250);
    source.start(0);

    const drawLoop = () => {
      const elapsed = performance.now() - startPerf;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);

      let activeId: string | null = null;
      for (const w of windows) {
        if (elapsed >= w.startMs && elapsed < w.endMs) {
          activeId = w.imageId;
        }
      }
      if (activeId) {
        const img = loadedImages.get(activeId);
        if (img) {
          const ir = img.naturalWidth / Math.max(1, img.naturalHeight);
          const tr = width / height;
          let sx = 0;
          let sy = 0;
          let sw = img.naturalWidth;
          let sh = img.naturalHeight;
          if (ir > tr) {
            sw = img.naturalHeight * tr;
            sx = (img.naturalWidth - sw) / 2;
          } else {
            sh = img.naturalWidth / tr;
            sy = (img.naturalHeight - sh) / 2;
          }
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
        }
      }

      if (elapsed >= totalMs) {
        source.stop();
        recorder.stop();
        return;
      }
      rafId = requestAnimationFrame(drawLoop);
    };

    rafId = requestAnimationFrame(drawLoop);
  });
}
