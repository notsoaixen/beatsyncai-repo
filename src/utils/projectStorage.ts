import { BeatProject, ImageAsset, ProjectSummary } from '../types/beatsync';

const DB_NAME = 'BeatSyncAI_DB';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';

interface StoredImageRecord {
  id: string;
  name: string;
  width: number;
  height: number;
  mimeType: string;
  blob: Blob;
}

interface StoredProjectRecord {
  id: string;
  title: string;
  originalMediaName: string | null;
  isExtractedFromVideo: boolean;
  audioBlob: Blob | null;
  audioMimeType: string;
  durationMs: number;
  estimatedBpm: number;
  detectionMode: BeatProject['detectionMode'];
  sensitivity: number;
  aspectRatio: BeatProject['aspectRatio'];
  beats: BeatProject['beats'];
  images: StoredImageRecord[];
  patternImageIds: string[];
  patternDurationMode: BeatProject['patternDurationMode'];
  patternCustomDurationMs: number;
  waveformPeaks: Float32Array;
  updatedAtMs: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveProjectToDb(
  project: BeatProject,
  waveformPeaks: Float32Array,
): Promise<void> {
  const db = await openDb();
  const record: StoredProjectRecord = {
    id: project.id,
    title: project.title,
    originalMediaName: project.originalMediaName,
    isExtractedFromVideo: project.isExtractedFromVideo,
    audioBlob: project.audioBlob,
    audioMimeType: project.audioMimeType,
    durationMs: project.durationMs,
    estimatedBpm: project.estimatedBpm,
    detectionMode: project.detectionMode,
    sensitivity: project.sensitivity,
    aspectRatio: project.aspectRatio,
    beats: project.beats,
    images: project.images.map((img) => ({
      id: img.id,
      name: img.name,
      width: img.width,
      height: img.height,
      mimeType: img.mimeType,
      blob: img.blob,
    })),
    patternImageIds: project.patternImageIds,
    patternDurationMode: project.patternDurationMode,
    patternCustomDurationMs: project.patternCustomDurationMs,
    waveformPeaks,
    updatedAtMs: Date.now(),
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readwrite');
    tx.objectStore(STORE_PROJECTS).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listProjectSummaries(): Promise<ProjectSummary[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readonly');
    const req = tx.objectStore(STORE_PROJECTS).getAll();
    req.onsuccess = () => {
      const items = (req.result as StoredProjectRecord[]) || [];
      items.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      resolve(
        items.map((r) => ({
          id: r.id,
          title: r.title,
          updatedAtMs: r.updatedAtMs,
          durationMs: r.durationMs,
          beatCount: r.beats.length,
          estimatedBpm: r.estimatedBpm,
        })),
      );
    };
    req.onerror = () => reject(req.error);
  });
}

export async function loadProjectFromDb(
  id: string,
): Promise<{ project: BeatProject; waveformPeaks: Float32Array } | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readonly');
    const req = tx.objectStore(STORE_PROJECTS).get(id);
    req.onsuccess = () => {
      const r = req.result as StoredProjectRecord | undefined;
      if (!r) {
        resolve(null);
        return;
      }
      const images: ImageAsset[] = r.images.map((img) => ({
        ...img,
        objectUrl: URL.createObjectURL(img.blob),
      }));
      resolve({
        project: {
          id: r.id,
          title: r.title,
          originalMediaName: r.originalMediaName,
          isExtractedFromVideo: r.isExtractedFromVideo,
          audioBlob: r.audioBlob,
          audioMimeType: r.audioMimeType,
          durationMs: r.durationMs,
          estimatedBpm: r.estimatedBpm,
          detectionMode: r.detectionMode,
          sensitivity: r.sensitivity,
          aspectRatio: r.aspectRatio,
          beats: r.beats,
          images,
          patternImageIds: r.patternImageIds,
          patternDurationMode: r.patternDurationMode,
          patternCustomDurationMs: r.patternCustomDurationMs,
          updatedAtMs: r.updatedAtMs,
        },
        waveformPeaks: r.waveformPeaks || new Float32Array(0),
      });
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteProjectFromDb(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readwrite');
    tx.objectStore(STORE_PROJECTS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function createSolidColorPlateAsset(
  name: string,
  hexColor: string,
): Promise<ImageAsset> {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = hexColor;
    ctx.fillRect(0, 0, 1080, 1080);
  }
  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b || new Blob()), 'image/png');
  });
  return {
    id: crypto.randomUUID(),
    name,
    width: 1080,
    height: 1080,
    mimeType: 'image/png',
    blob,
    objectUrl: URL.createObjectURL(blob),
  };
}

export async function loadImageAssetFromFile(file: File): Promise<ImageAsset> {
  const objectUrl = URL.createObjectURL(file);
  const dims = await new Promise<{ width: number; height: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 1080, height: img.naturalHeight || 1080 });
    img.onerror = () => resolve({ width: 1080, height: 1080 });
    img.src = objectUrl;
  });

  return {
    id: crypto.randomUUID(),
    name: file.name,
    width: dims.width,
    height: dims.height,
    mimeType: file.type || 'image/png',
    blob: file,
    objectUrl,
  };
}
