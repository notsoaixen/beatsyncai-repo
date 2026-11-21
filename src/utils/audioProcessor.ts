import { Capacitor } from '@capacitor/core';
import type { AudioEnvelopeFrame, BeatMarker, BeatType } from '../types/beatsync';

export interface ProcessedAudioResult {
  audioBlob: Blob;
  audioMimeType: string;
  isExtractedFromVideo: boolean;
  durationMs: number;
  waveformPeaks: Float32Array;
  envelopeFrames: AudioEnvelopeFrame[];
  initialBeats: BeatMarker[];
  estimatedBpm: number;
}

const VIDEO_EXTENSIONS = new Set(['mp4', 'mkv', 'webm', 'mov', 'avi', '3gp', 'm4v']);

const CLOUD_API_BASE =
  'https://ais-pre-dnsfrqp4zd25fihckvpsvz-202592899235.asia-southeast1.run.app';

export function resolveApiUrl(path: string): string {
  if (Capacitor.isNativePlatform()) {
    return `${CLOUD_API_BASE}${path}`;
  }
  return path;
}

export function isVideoFile(file: File): boolean {
  if (file.type.startsWith('video/')) return true;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return VIDEO_EXTENSIONS.has(ext);
}

export async function importAndAnalyzeMedia(
  file: File,
  sensitivity: number,
  onProgress: (progress: number, message: string) => void,
): Promise<ProcessedAudioResult> {
  const videoSource = isVideoFile(file);
  let audioBlob: Blob = file;
  let audioMimeType = file.type || (videoSource ? 'video/mp4' : 'audio/mpeg');

  onProgress(0.2, videoSource ? 'Extracting audio track...' : 'Decoding audio waveform...');
  let arrayBuffer = await audioBlob.arrayBuffer();
  const audioCtx = new AudioContext();
  let decoded: AudioBuffer;

  try {
    // Try native in-device AudioContext decoding first (works offline on Android APK for MP3, WAV, AAC, M4A, OGG, MP4, WEBM!)
    decoded = await audioCtx.decodeAudioData(arrayBuffer);
  } catch {
    // Fallback for exotic containers (e.g., MKV/AVI/MOV/AC3): extract clean M4A via server FFmpeg
    onProgress(0.35, 'Extracting audio via FFmpeg...');
    const formData = new FormData();
    formData.append('media', file, file.name);
    const resp = await fetch(resolveApiUrl('/api/extract-audio'), {
      method: 'POST',
      body: formData,
    });
    if (!resp.ok) {
      await audioCtx.close();
      const errJson = await resp.json().catch(() => ({ error: 'Unsupported media format' }));
      throw new Error(errJson.error || 'Unsupported media format.');
    }
    audioBlob = await resp.blob();
    audioMimeType = 'audio/mp4';
    arrayBuffer = await audioBlob.arrayBuffer();
    decoded = await audioCtx.decodeAudioData(arrayBuffer);
  }

  const durationMs = Math.round(decoded.duration * 1000);
  const sampleRate = decoded.sampleRate;
  const numChannels = decoded.numberOfChannels;
  const length = decoded.length;

  // Downsample 2x when >= 44.1kHz to keep RAM low on mid/low-end Android devices
  const stride = sampleRate >= 44100 ? 2 : 1;
  const effectiveSr = Math.round(sampleRate / stride);
  const monoLen = Math.floor(length / stride);
  const mono = new Float32Array(monoLen);

  for (let c = 0; c < numChannels; c++) {
    const chData = decoded.getChannelData(c);
    for (let i = 0; i < monoLen; i++) {
      mono[i] += chData[i * stride] / numChannels;
    }
  }
  await audioCtx.close();

  onProgress(0.72, 'Analyzing rhythm & detecting beats...');
  const workerRes = await runWorkerAnalysis(mono, effectiveSr, durationMs, sensitivity);

  onProgress(1, 'Ready');
  return {
    audioBlob,
    audioMimeType,
    isExtractedFromVideo: videoSource,
    durationMs,
    waveformPeaks: workerRes.waveformPeaks,
    envelopeFrames: workerRes.envelopeFrames,
    initialBeats: workerRes.beats,
    estimatedBpm: workerRes.estimatedBpm,
  };
}

function runWorkerAnalysis(
  pcm: Float32Array,
  sampleRate: number,
  durationMs: number,
  sensitivity: number,
): Promise<{
  waveformPeaks: Float32Array;
  envelopeFrames: AudioEnvelopeFrame[];
  beats: BeatMarker[];
  estimatedBpm: number;
}> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/beatDetector.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (ev) => {
      if (ev.data?.type === 'ANALYZED') {
        worker.terminate();
        resolve({
          waveformPeaks: ev.data.waveformPeaks,
          envelopeFrames: ev.data.envelopeFrames,
          beats: ev.data.beats,
          estimatedBpm: ev.data.estimatedBpm,
        });
      }
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(err.message || 'Audio analysis worker failed'));
    };
    worker.postMessage(
      { type: 'ANALYZE_PCM', pcm, sampleRate, durationMs, sensitivity },
      [pcm.buffer],
    );
  });
}

export function runStandardBeatDetectionWorker(
  envelopeFrames: AudioEnvelopeFrame[],
  sensitivity: number,
): Promise<{ beats: BeatMarker[]; estimatedBpm: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/beatDetector.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (ev) => {
      if (ev.data?.type === 'DETECTED') {
        worker.terminate();
        resolve({
          beats: ev.data.beats,
          estimatedBpm: ev.data.estimatedBpm,
        });
      }
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(err.message || 'Beat detection worker failed'));
    };
    worker.postMessage({ type: 'DETECT_BEATS', envelopeFrames, sensitivity });
  });
}

export async function runAiBeatDetection(params: {
  audioBlob: Blob | null;
  audioMimeType: string;
  durationMs: number;
  envelopeFrames: AudioEnvelopeFrame[];
  sensitivity: number;
}): Promise<{ beats: BeatMarker[]; estimatedBpm: number; musicalStyle: string }> {
  const { audioBlob, audioMimeType, durationMs, envelopeFrames, sensitivity } = params;
  if (envelopeFrames.length === 0) {
    throw new Error('Audio envelope is not ready. Re-import the audio track.');
  }

  let maxScore = 0.0001;
  let maxRms = 0.0001;
  const scores = new Float32Array(envelopeFrames.length);
  for (let i = 0; i < envelopeFrames.length; i++) {
    const f = envelopeFrames[i];
    const sc = f.kickEnergy * 0.45 + f.snareMidEnergy * 0.4 + f.highEnergy * 0.15;
    scores[i] = sc;
    if (sc > maxScore) maxScore = sc;
    if (f.rms > maxRms) maxRms = f.rms;
  }

  interface Candidate {
    t: number;
    score: number;
    k: number;
    s: number;
    h: number;
    r: number;
  }
  const peaks: Candidate[] = [];
  for (let i = 1; i < envelopeFrames.length - 1; i++) {
    if (scores[i] >= scores[i - 1] && scores[i] >= scores[i + 1] && scores[i] > maxScore * 0.1) {
      const f = envelopeFrames[i];
      const item: Candidate = {
        t: f.timeMs,
        score: scores[i],
        k: Math.min(100, Math.round((f.kickEnergy / maxScore) * 100)),
        s: Math.min(100, Math.round((f.snareMidEnergy / maxScore) * 100)),
        h: Math.min(100, Math.round((f.highEnergy / maxScore) * 100)),
        r: Math.min(100, Math.round((f.rms / maxRms) * 100)),
      };
      if (peaks.length === 0 || f.timeMs - peaks[peaks.length - 1].t >= 80) {
        peaks.push(item);
      } else if (scores[i] > peaks[peaks.length - 1].score) {
        peaks[peaks.length - 1] = item;
      }
    }
  }

  const trimmed =
    peaks.length > 420
      ? [...peaks].sort((a, b) => b.score - a.score).slice(0, 420).sort((a, b) => a.t - b.t)
      : peaks;

  const buckets = Math.min(240, Math.max(1, Math.floor(durationMs / 1000)));
  const sums = new Float32Array(buckets);
  const counts = new Int32Array(buckets);
  for (const f of envelopeFrames) {
    const b = Math.min(buckets - 1, Math.max(0, Math.floor((f.timeMs * buckets) / Math.max(1, durationMs))));
    sums[b] += f.rms;
    counts[b]++;
  }
  const energySummary = Array.from({ length: buckets }, (_, b) => {
    const avg = counts[b] > 0 ? sums[b] / counts[b] / maxRms : 0;
    return `${b}:${Math.round(avg * 100)}`;
  }).join(' ');

  let audioBase64: string | undefined;
  let resolvedMime: string | undefined;
  if (audioBlob && audioBlob.size > 0 && audioBlob.size <= 4 * 1024 * 1024) {
    audioBase64 = await blobToBase64(audioBlob);
    resolvedMime = audioMimeType.startsWith('audio/') ? audioMimeType : 'audio/mp4';
  }

  const resp = await fetch(resolveApiUrl('/api/ai-beats'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      durationMs,
      sensitivity,
      energySummary,
      candidates: trimmed.map(({ t, k, s, h, r }) => ({ t, k, s, h, r })),
      audioBase64,
      audioMime: resolvedMime,
    }),
  });

  const json = await resp.json();
  if (!resp.ok) {
    throw new Error(json.error || 'Advanced AI beat detection failed');
  }

  const rawBeats: Array<{ timestampMs: number; type: string; confidence?: number }> = json.beats || [];
  if (rawBeats.length === 0) {
    throw new Error('AI returned zero beat markers for this track.');
  }

  const sortedAi = [...rawBeats].sort((a, b) => a.timestampMs - b.timestampMs);
  const snapped: BeatMarker[] = [];

  for (const b of sortedAi) {
    if (b.timestampMs < 0 || b.timestampMs > durationMs) continue;
    let bestMs = b.timestampMs;
    let bestE = -1;
    for (const f of envelopeFrames) {
      if (f.timeMs < b.timestampMs - 45) continue;
      if (f.timeMs > b.timestampMs + 45) break;
      const e = f.kickEnergy * 0.45 + f.snareMidEnergy * 0.45 + f.highEnergy * 0.1;
      if (e > bestE) {
        bestE = e;
        bestMs = f.timeMs;
      }
    }
    if (snapped.length > 0 && Math.abs(bestMs - snapped[snapped.length - 1].timestampMs) < 120) {
      continue;
    }
    const upper = (b.type || 'ACCENT').toUpperCase();
    const beatType: BeatType =
      upper === 'KICK' || upper === 'SNARE_CLAP' || upper === 'DROP' || upper === 'ACCENT'
        ? upper
        : 'ACCENT';

    snapped.push({
      id: crypto.randomUUID(),
      timestampMs: bestMs,
      type: beatType,
      confidence: Math.min(1, Math.max(0.2, b.confidence ?? 0.9)),
      assignedImageId: null,
      durationMode: 'ONE_BEAT',
      customDurationMs: 350,
    });
  }

  return {
    beats: snapped,
    estimatedBpm: Math.round((Number(json.estimatedBpm) || 120) * 10) / 10,
    musicalStyle: json.musicalStyle || 'AI Musical Structure',
  };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read audio bytes'));
    reader.readAsDataURL(blob);
  });
}
