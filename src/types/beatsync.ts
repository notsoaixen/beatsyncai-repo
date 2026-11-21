export type BeatType = 'KICK' | 'SNARE_CLAP' | 'DROP' | 'ACCENT' | 'MANUAL';

export type DetectionMode = 'STANDARD' | 'ADVANCED_AI' | 'MANUAL';

export type DurationMode = 'ONE_BEAT' | 'TWO_BEATS' | 'CUSTOM_MS';

export type AspectRatioPreset = '9:16' | '16:9' | '1:1';

export type ExportResolution = '720p' | '1080p';

export type ExportFps = 30 | 60;

export interface ImageAsset {
  id: string;
  name: string;
  width: number;
  height: number;
  mimeType: string;
  blob: Blob;
  objectUrl: string;
}

export interface BeatMarker {
  id: string;
  timestampMs: number;
  type: BeatType;
  confidence: number;
  assignedImageId: string | null;
  durationMode: DurationMode;
  customDurationMs: number;
}

export interface AudioEnvelopeFrame {
  timeMs: number;
  kickEnergy: number;
  snareMidEnergy: number;
  highEnergy: number;
  broadbandFlux: number;
  rms: number;
}

export interface BeatProject {
  id: string;
  title: string;
  originalMediaName: string | null;
  isExtractedFromVideo: boolean;
  audioBlob: Blob | null;
  audioMimeType: string;
  durationMs: number;
  estimatedBpm: number;
  detectionMode: DetectionMode;
  sensitivity: number;
  aspectRatio: AspectRatioPreset;
  beats: BeatMarker[];
  images: ImageAsset[];
  patternImageIds: string[];
  patternDurationMode: DurationMode;
  patternCustomDurationMs: number;
  updatedAtMs: number;
}

export interface ProjectSummary {
  id: string;
  title: string;
  updatedAtMs: number;
  durationMs: number;
  beatCount: number;
  estimatedBpm: number;
}

export function getResolutionDimensions(
  aspectRatio: AspectRatioPreset,
  resolution: ExportResolution,
): { width: number; height: number } {
  const is1080 = resolution === '1080p';
  switch (aspectRatio) {
    case '9:16':
      return is1080 ? { width: 1080, height: 1920 } : { width: 720, height: 1280 };
    case '16:9':
      return is1080 ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
    case '1:1':
      return is1080 ? { width: 1080, height: 1080 } : { width: 720, height: 720 };
  }
}

export function formatTimecode(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const totalSec = Math.floor(clamped / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const millis = clamped % 1000;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export function formatShortTimecode(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const totalSec = Math.floor(clamped / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const tenths = Math.floor((clamped % 1000) / 100);
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${tenths}`;
}

export function resolveBeatImageWindow(
  beats: BeatMarker[],
  index: number,
  trackDurationMs: number,
): { startMs: number; endMs: number } {
  const marker = beats[index];
  const startMs = marker.timestampMs;
  const nextBeat = beats[index + 1]?.timestampMs;
  const twoBeatsLater = beats[index + 2]?.timestampMs;
  const maxEnd = trackDurationMs > startMs ? trackDurationMs : startMs + 1000;

  let endMs: number;
  if (marker.durationMode === 'ONE_BEAT') {
    endMs = nextBeat ?? maxEnd;
  } else if (marker.durationMode === 'TWO_BEATS') {
    endMs = twoBeatsLater ?? nextBeat ?? maxEnd;
  } else {
    endMs = Math.min(maxEnd, startMs + Math.max(30, marker.customDurationMs));
  }

  return {
    startMs,
    endMs: Math.max(startMs + 16, endMs),
  };
}
