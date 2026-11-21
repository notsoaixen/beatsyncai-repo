import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FolderOpen,
  LayoutGrid,
  Music,
  Pause,
  Play,
  Plus,
  Redo2,
  Share2,
  SkipBack,
  SkipForward,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react';
import { BeatTimeline } from './components/BeatTimeline';
import { ControlDock, StudioTab } from './components/ControlDock';
import { ProjectsModal } from './components/ProjectsModal';
import { VideoPreview } from './components/VideoPreview';
import {
  AspectRatioPreset,
  AudioEnvelopeFrame,
  BeatMarker,
  BeatProject,
  DetectionMode,
  DurationMode,
  ExportFps,
  ExportResolution,
  ProjectSummary,
  formatShortTimecode,
  formatTimecode,
} from './types/beatsync';
import {
  buildAlightMotionBundleZip,
  buildAlightMotionXml,
  buildMarkersCsv,
  buildMarkersJson,
  sanitizeBaseName,
  triggerDownload,
} from './utils/alightMotionExport';
import {
  importAndAnalyzeMedia,
  runAiBeatDetection,
  runStandardBeatDetectionWorker,
} from './utils/audioProcessor';
import {
  createSolidColorPlateAsset,
  deleteProjectFromDb,
  listProjectSummaries,
  loadImageAssetFromFile,
  loadProjectFromDb,
  saveProjectToDb,
} from './utils/projectStorage';
import { exportProjectMp4 } from './utils/videoExport';

interface EditSnapshot {
  beats: BeatMarker[];
  patternImageIds: string[];
}

function createEmptyProject(title = 'Anime Edit 01'): BeatProject {
  return {
    id: crypto.randomUUID(),
    title,
    originalMediaName: null,
    isExtractedFromVideo: false,
    audioBlob: null,
    audioMimeType: 'audio/mp4',
    durationMs: 0,
    estimatedBpm: 0,
    detectionMode: 'STANDARD',
    sensitivity: 0.55,
    aspectRatio: '9:16',
    beats: [],
    images: [],
    patternImageIds: [],
    patternDurationMode: 'ONE_BEAT',
    patternCustomDurationMs: 350,
    updatedAtMs: Date.now(),
  };
}

export default function App() {
  const [project, setProject] = useState<BeatProject>(() => createEmptyProject());
  const [waveformPeaks, setWaveformPeaks] = useState<Float32Array>(() => new Float32Array(0));
  const [selectedBeatId, setSelectedBeatId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<StudioTab>('IMPORT');
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);

  const [isBusy, setIsBusy] = useState(false);
  const [busyProgress, setBusyProgress] = useState(0);
  const [busyMessage, setBusyMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const [snapToPeak, setSnapToPeak] = useState(true);
  const [aiMusicalNotes, setAiMusicalNotes] = useState('');
  const [exportResolution, setExportResolution] = useState<ExportResolution>('1080p');
  const [exportFps, setExportFps] = useState<ExportFps>(60);

  const [savedProjects, setSavedProjects] = useState<ProjectSummary[]>([]);
  const [projectsOpen, setProjectsOpen] = useState(false);

  const [undoStack, setUndoStack] = useState<EditSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<EditSnapshot[]>([]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioObjectUrlRef = useRef<string | null>(null);
  const envelopeFramesRef = useRef<AudioEnvelopeFrame[]>([]);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const rafRef = useRef<number | null>(null);

  // Load most recent project from IndexedDB on startup
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const summaries = await listProjectSummaries();
        if (!mounted) return;
        setSavedProjects(summaries);
        if (summaries.length > 0) {
          const loaded = await loadProjectFromDb(summaries[0].id);
          if (loaded && mounted) {
            setProject(loaded.project);
            setWaveformPeaks(loaded.waveformPeaks);
            setSelectedBeatId(loaded.project.beats[0]?.id ?? null);
            if (loaded.project.audioBlob) setActiveTab('DETECT');
          }
        }
      } catch {
        // Ignore storage read errors in restricted contexts
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Bind project.audioBlob to <audio> element
  useEffect(() => {
    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    }
    const audio = audioRef.current;
    if (!audio) return;

    audio.pause();
    setIsPlaying(false);
    setPositionMs(0);

    if (project.audioBlob) {
      const url = URL.createObjectURL(project.audioBlob);
      audioObjectUrlRef.current = url;
      audio.src = url;
      audio.load();

      // Rebuild lightweight DSP envelope in background if opened from IndexedDB
      if (envelopeFramesRef.current.length === 0) {
        const tempFile = new File([project.audioBlob], project.originalMediaName || 'audio.m4a', {
          type: project.audioMimeType || 'audio/mp4',
        });
        importAndAnalyzeMedia(tempFile, project.sensitivity, () => {})
          .then((res) => {
            envelopeFramesRef.current = res.envelopeFrames;
            if (waveformPeaks.length === 0) setWaveformPeaks(res.waveformPeaks);
          })
          .catch(() => {});
      }
    } else {
      audio.removeAttribute('src');
    }
  }, [project.id, project.audioBlob]);

  // 60fps requestAnimationFrame playhead sync while playing
  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    const tick = () => {
      const audio = audioRef.current;
      if (audio && !audio.paused) {
        setPositionMs(Math.round(audio.currentTime * 1000));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying]);

  // Auto-save project to IndexedDB when meaningful content exists
  const persistProject = useCallback(
    async (nextProject: BeatProject, nextPeaks: Float32Array) => {
      if (!nextProject.audioBlob && nextProject.beats.length === 0 && nextProject.images.length === 0) {
        return;
      }
      try {
        await saveProjectToDb(nextProject, nextPeaks);
        const list = await listProjectSummaries();
        setSavedProjects(list);
      } catch {
        // Ignore quota errors
      }
    },
    [],
  );

  const pushUndo = useCallback((proj: BeatProject) => {
    setUndoStack((prev) => [...prev.slice(-39), { beats: proj.beats, patternImageIds: proj.patternImageIds }]);
    setRedoStack([]);
  }, []);

  const recalcBpm = useCallback((beats: BeatMarker[], fallback: number): number => {
    if (beats.length < 3) return fallback;
    const iois: number[] = [];
    for (let i = 1; i < beats.length; i++) {
      const dt = beats[i].timestampMs - beats[i - 1].timestampMs;
      if (dt >= 250 && dt <= 1400) iois.push(dt);
    }
    if (iois.length === 0) return fallback;
    iois.sort((a, b) => a - b);
    const med = iois[Math.floor(iois.length / 2)];
    return Math.round((60000 / med) * 10) / 10;
  }, []);

  const snapToNearestPeak = useCallback((targetMs: number): number => {
    const frames = envelopeFramesRef.current;
    if (frames.length === 0) return targetMs;
    let bestMs = targetMs;
    let bestE = -1;
    for (const f of frames) {
      if (f.timeMs < targetMs - 35) continue;
      if (f.timeMs > targetMs + 35) break;
      const e = f.kickEnergy * 0.45 + f.snareMidEnergy * 0.45 + f.highEnergy * 0.1;
      if (e > bestE) {
        bestE = e;
        bestMs = f.timeMs;
      }
    }
    return bestMs;
  }, []);

  const applyPatternToBeats = useCallback(
    (
      beats: BeatMarker[],
      patternIds: string[],
      durationMode: DurationMode,
      customMs: number,
    ): BeatMarker[] => {
      if (patternIds.length === 0) return beats;
      const sorted = [...beats].sort((a, b) => a.timestampMs - b.timestampMs);
      const stepSpan = durationMode === 'TWO_BEATS' ? 2 : 1;
      let cursor = 0;
      return sorted.map((b, idx) => {
        if (stepSpan === 2 && idx % 2 === 1) {
          return { ...b, assignedImageId: null };
        }
        const imgId = patternIds[cursor % patternIds.length];
        cursor++;
        return {
          ...b,
          assignedImageId: imgId,
          durationMode,
          customDurationMs: customMs,
        };
      });
    },
    [],
  );

  // --- Playback controls ---
  const seekTo = useCallback((ms: number) => {
    const audio = audioRef.current;
    const clamped = Math.max(0, Math.min(project.durationMs || 0, ms));
    setPositionMs(clamped);
    if (audio) audio.currentTime = clamped / 1000;
  }, [project.durationMs]);

  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !project.audioBlob) return;
    if (audio.paused) {
      if (audio.currentTime * 1000 >= (project.durationMs || 0) - 30) {
        audio.currentTime = 0;
      }
      void audio.play();
      setIsPlaying(true);
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }, [project.audioBlob, project.durationMs]);

  const playFromBeat = useCallback((beat: BeatMarker) => {
    setSelectedBeatId(beat.id);
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = beat.timestampMs / 1000;
    setPositionMs(beat.timestampMs);
    if (audio.paused) {
      void audio.play();
      setIsPlaying(true);
    }
  }, []);

  // --- Media Import ---
  const handleMediaFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    audioRef.current?.pause();
    setIsPlaying(false);
    setErrorMessage(null);
    setInfoMessage(null);
    setIsBusy(true);
    setBusyProgress(0.05);
    setBusyMessage('Importing media...');

    try {
      const result = await importAndAnalyzeMedia(file, project.sensitivity, (p, msg) => {
        setBusyProgress(p);
        setBusyMessage(msg);
      });

      envelopeFramesRef.current = result.envelopeFrames;
      setWaveformPeaks(result.waveformPeaks);

      const cleanTitle =
        project.title === 'Anime Edit 01' || project.title === 'New Beat Edit'
          ? file.name.replace(/\.[^.]+$/, '') || project.title
          : project.title;

      const nextBeats =
        project.patternImageIds.length > 0
          ? applyPatternToBeats(
              result.initialBeats,
              project.patternImageIds,
              project.patternDurationMode,
              project.patternCustomDurationMs,
            )
          : result.initialBeats;

      const updated: BeatProject = {
        ...project,
        title: cleanTitle,
        originalMediaName: file.name,
        isExtractedFromVideo: result.isExtractedFromVideo,
        audioBlob: result.audioBlob,
        audioMimeType: result.audioMimeType,
        durationMs: result.durationMs,
        estimatedBpm: result.estimatedBpm,
        detectionMode: 'STANDARD',
        beats: nextBeats,
      };

      setUndoStack([]);
      setRedoStack([]);
      setProject(updated);
      setSelectedBeatId(nextBeats[0]?.id ?? null);
      setInfoMessage(
        result.isExtractedFromVideo
          ? `Extracted audio from video · ${nextBeats.length} beats (${result.estimatedBpm} BPM)`
          : `Detected ${nextBeats.length} beats (${result.estimatedBpm} BPM)`,
      );
      void persistProject(updated, result.waveformPeaks);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to import media');
    } finally {
      setIsBusy(false);
      setBusyMessage('');
    }
  };

  const handleImagesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;

    const loaded = await Promise.all(files.map((f) => loadImageAssetFromFile(f)));
    const nextImages = [...project.images, ...loaded];
    const nextPattern =
      project.patternImageIds.length === 0 ? loaded.map((i) => i.id) : project.patternImageIds;
    const updated = { ...project, images: nextImages, patternImageIds: nextPattern };
    setProject(updated);
    setInfoMessage(`Imported ${loaded.length} image(s)`);
    void persistProject(updated, waveformPeaks);
  };

  const handleAddWhiteAndGreenPlates = async () => {
    const white = await createSolidColorPlateAsset('White.png', '#FFFFFF');
    const green = await createSolidColorPlateAsset('Green.png', '#16E575');
    const updated: BeatProject = {
      ...project,
      images: [...project.images, white, green],
      patternImageIds: [white.id, green.id],
    };
    setProject(updated);
    setInfoMessage('Created White.png & Green.png and set alternating pattern');
    void persistProject(updated, waveformPeaks);
  };

  const handleAddBlackPlate = async () => {
    const black = await createSolidColorPlateAsset('Black.png', '#000000');
    const updated: BeatProject = {
      ...project,
      images: [...project.images, black],
      patternImageIds: [...project.patternImageIds, black.id],
    };
    setProject(updated);
    void persistProject(updated, waveformPeaks);
  };

  // --- Beat Detection (3 modes) ---
  const handleRunDetection = async (mode: DetectionMode) => {
    if (!project.audioBlob) {
      setErrorMessage('Import an audio or video file first.');
      return;
    }
    if (mode === 'MANUAL') {
      const updated = { ...project, detectionMode: 'MANUAL' as DetectionMode };
      setProject(updated);
      setInfoMessage('Manual mode active: tap timeline, drag markers, or tap Beat live.');
      return;
    }

    setErrorMessage(null);
    setInfoMessage(null);
    setIsBusy(true);
    setBusyProgress(0.35);
    setBusyMessage(
      mode === 'ADVANCED_AI'
        ? 'Gemini AI analyzing musical rhythm...'
        : 'Running Standard beat detection...',
    );

    try {
      pushUndo(project);
      let newBeats: BeatMarker[];
      let newBpm: number;
      let styleNotes = '';

      if (mode === 'ADVANCED_AI') {
        const res = await runAiBeatDetection({
          audioBlob: project.audioBlob,
          audioMimeType: project.audioMimeType,
          durationMs: project.durationMs,
          envelopeFrames: envelopeFramesRef.current,
          sensitivity: project.sensitivity,
        });
        newBeats = res.beats;
        newBpm = res.estimatedBpm;
        styleNotes = res.musicalStyle;
      } else {
        const res = await runStandardBeatDetectionWorker(
          envelopeFramesRef.current,
          project.sensitivity,
        );
        newBeats = res.beats;
        newBpm = res.estimatedBpm;
      }

      if (project.patternImageIds.length > 0) {
        newBeats = applyPatternToBeats(
          newBeats,
          project.patternImageIds,
          project.patternDurationMode,
          project.patternCustomDurationMs,
        );
      }

      const updated: BeatProject = {
        ...project,
        detectionMode: mode,
        estimatedBpm: newBpm,
        beats: newBeats,
      };
      setProject(updated);
      setSelectedBeatId(newBeats[0]?.id ?? null);
      setAiMusicalNotes(styleNotes);
      setInfoMessage(
        `${mode === 'ADVANCED_AI' ? 'Advanced AI' : 'Standard'}: ${newBeats.length} beats (${newBpm} BPM)${
          styleNotes ? ` · ${styleNotes}` : ''
        }`,
      );
      void persistProject(updated, waveformPeaks);
    } catch (err) {
      setUndoStack((prev) => prev.slice(0, -1));
      setErrorMessage(err instanceof Error ? err.message : 'Beat detection failed');
    } finally {
      setIsBusy(false);
      setBusyMessage('');
    }
  };

  // --- Marker Editing + Undo/Redo ---
  const addBeatAt = useCallback(
    (ms: number) => {
      if (project.durationMs <= 0) return;
      const clamped = Math.max(0, Math.min(project.durationMs, ms));
      const target = snapToPeak ? snapToNearestPeak(clamped) : clamped;
      const existing = project.beats.find((b) => Math.abs(b.timestampMs - target) < 40);
      if (existing) {
        setSelectedBeatId(existing.id);
        return;
      }
      pushUndo(project);
      const marker: BeatMarker = {
        id: crypto.randomUUID(),
        timestampMs: target,
        type: 'MANUAL',
        confidence: 1,
        assignedImageId: null,
        durationMode: 'ONE_BEAT',
        customDurationMs: 350,
      };
      const nextBeats = [...project.beats, marker].sort((a, b) => a.timestampMs - b.timestampMs);
      const updated = {
        ...project,
        beats: nextBeats,
        estimatedBpm: recalcBpm(nextBeats, project.estimatedBpm),
      };
      setProject(updated);
      setSelectedBeatId(marker.id);
      void persistProject(updated, waveformPeaks);
    },
    [persistProject, project, pushUndo, recalcBpm, snapToNearestPeak, snapToPeak, waveformPeaks],
  );

  const handleUndo = () => {
    const snap = undoStack[undoStack.length - 1];
    if (!snap) return;
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev, { beats: project.beats, patternImageIds: project.patternImageIds }]);
    const updated = { ...project, beats: snap.beats, patternImageIds: snap.patternImageIds };
    setProject(updated);
    setSelectedBeatId(snap.beats[0]?.id ?? null);
    void persistProject(updated, waveformPeaks);
  };

  const handleRedo = () => {
    const snap = redoStack[redoStack.length - 1];
    if (!snap) return;
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev, { beats: project.beats, patternImageIds: project.patternImageIds }]);
    const updated = { ...project, beats: snap.beats, patternImageIds: snap.patternImageIds };
    setProject(updated);
    setSelectedBeatId(snap.beats[0]?.id ?? null);
    void persistProject(updated, waveformPeaks);
  };

  // --- Exports ---
  const handleExportMp4 = async () => {
    audioRef.current?.pause();
    setIsPlaying(false);
    setErrorMessage(null);
    setIsBusy(true);
    setBusyProgress(0.4);
    setBusyMessage('Rendering MP4 video with original audio...');
    try {
      const mp4Blob = await exportProjectMp4({
        project,
        resolution: exportResolution,
        fps: exportFps,
        onProgress: (msg) => setBusyMessage(msg),
      });
      const fileName = `${sanitizeBaseName(project.title)}_${exportResolution}_${exportFps}fps.mp4`;
      triggerDownload(mp4Blob, fileName);
      setInfoMessage(`Downloaded ${fileName}`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'MP4 export failed');
    } finally {
      setIsBusy(false);
      setBusyMessage('');
    }
  };

  const handleExportXml = () => {
    const xml = buildAlightMotionXml(project, exportResolution, exportFps);
    const fileName = `${sanitizeBaseName(project.title)}_alight_motion.xml`;
    triggerDownload(new Blob([xml], { type: 'text/xml;charset=utf-8' }), fileName);
    setInfoMessage(`Downloaded ${fileName}`);
  };

  const handleExportBundleZip = async () => {
    setIsBusy(true);
    setBusyProgress(0.6);
    setBusyMessage('Packaging Alight Motion XML + Media ZIP...');
    try {
      const zipBlob = await buildAlightMotionBundleZip(project, exportResolution, exportFps);
      const fileName = `${sanitizeBaseName(project.title)}_alight_motion_bundle.zip`;
      triggerDownload(zipBlob, fileName);
      setInfoMessage(`Downloaded ${fileName}`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'ZIP export failed');
    } finally {
      setIsBusy(false);
      setBusyMessage('');
    }
  };

  const handleExportCsv = () => {
    const csv = buildMarkersCsv(project);
    const fileName = `${sanitizeBaseName(project.title)}_beats.csv`;
    triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), fileName);
    setInfoMessage(`Downloaded ${fileName}`);
  };

  const handleExportJson = () => {
    const json = buildMarkersJson(project);
    const fileName = `${sanitizeBaseName(project.title)}_beats.json`;
    triggerDownload(new Blob([json], { type: 'application/json;charset=utf-8' }), fileName);
    setInfoMessage(`Downloaded ${fileName}`);
  };

  const selectedBeat = useMemo(
    () => project.beats.find((b) => b.id === selectedBeatId) ?? null,
    [project.beats, selectedBeatId],
  );

  const cycleAspectRatio = () => {
    const order: AspectRatioPreset[] = ['9:16', '16:9', '1:1'];
    const next = order[(order.indexOf(project.aspectRatio) + 1) % order.length];
    const updated = { ...project, aspectRatio: next };
    setProject(updated);
    void persistProject(updated, waveformPeaks);
  };

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-[#0A0D0C] text-[#F3F7F4]">
      <audio
        ref={audioRef}
        onEnded={() => setIsPlaying(false)}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
      />

      <input
        ref={mediaInputRef}
        type="file"
        accept="audio/*,video/*,.mkv,.mp4,.mp3,.wav,.aac,.m4a,.ogg,.flac,.webm,.mov"
        onChange={handleMediaFileSelected}
        className="hidden"
      />
      <input
        ref={imageInputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        onChange={handleImagesSelected}
        className="hidden"
      />

      {/* Top Studio Bar (48px) */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-[#28332E] bg-[#121715] px-3">
        <button
          type="button"
          onClick={() => setProjectsOpen(true)}
          className="flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-1 text-left hover:bg-[#1A221F] transition-colors"
        >
          <FolderOpen className="h-4 w-4 shrink-0 text-[#16E575]" />
          <div className="min-w-0">
            <div className="text-[10px] font-bold tracking-wider text-[#16E575]">BEATSYNC AI</div>
            <div className="max-w-[160px] sm:max-w-[260px] truncate text-xs font-semibold text-white">
              {project.title}
            </div>
          </div>
        </button>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            disabled={undoStack.length === 0}
            onClick={handleUndo}
            aria-label="Undo"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-white hover:bg-[#1A221F] disabled:opacity-30"
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={redoStack.length === 0}
            onClick={handleRedo}
            aria-label="Redo"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-white hover:bg-[#1A221F] disabled:opacity-30"
          >
            <Redo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('EXPORT')}
            className="rounded-lg border border-[#16E575] bg-[#132E20] px-3 py-1.5 text-xs font-bold text-[#16E575] hover:bg-[#16E575] hover:text-[#0A0D0C] transition-colors whitespace-nowrap"
          >
            Export
          </button>
        </div>
      </header>

      {/* Main Responsive Studio Area:
          Mobile: stacked Preview -> Transport -> Timeline -> ControlDock -> Bottom Tabs
          Desktop (lg:): Top 2-column (Preview left | ControlDock+Tabs right), Bottom full-width Transport + Timeline */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Upper Stage */}
        <div className="flex flex-1 min-h-0 flex-col lg:grid lg:grid-cols-12">
          {/* Preview Stage */}
          <div className="h-[195px] shrink-0 lg:col-span-7 lg:h-full border-b lg:border-b-0 lg:border-r border-[#28332E]">
            <VideoPreview
              hasAudio={Boolean(project.audioBlob)}
              positionMs={positionMs}
              durationMs={project.durationMs}
              beats={project.beats}
              images={project.images}
              aspectRatio={project.aspectRatio}
              onCycleAspectRatio={cycleAspectRatio}
            />
          </div>

          {/* Desktop Right / Mobile Bottom Control Dock */}
          <div className="hidden lg:flex lg:col-span-5 lg:flex-col lg:h-full lg:overflow-hidden bg-[#0A0D0C]">
            <div className="grid grid-cols-4 border-b border-[#28332E] bg-[#121715]">
              {(['IMPORT', 'DETECT', 'PATTERN', 'EXPORT'] as StudioTab[]).map((tab) => {
                const label =
                  tab === 'IMPORT'
                    ? 'Media'
                    : tab === 'DETECT'
                      ? 'Detect'
                      : tab === 'PATTERN'
                        ? 'Pattern'
                        : 'Export';
                const active = activeTab === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={`h-11 text-xs font-semibold border-b-2 transition-colors ${
                      active
                        ? 'border-[#16E575] text-[#16E575] bg-[#132E20]/40'
                        : 'border-transparent text-[#9BA8A1] hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <ControlDock
                activeTab={activeTab}
                project={project}
                selectedBeat={selectedBeat}
                positionMs={positionMs}
                snapToPeak={snapToPeak}
                aiMusicalNotes={aiMusicalNotes}
                exportResolution={exportResolution}
                exportFps={exportFps}
                onPickMedia={() => mediaInputRef.current?.click()}
                onPickImages={() => imageInputRef.current?.click()}
                onAddWhiteAndGreenPlates={handleAddWhiteAndGreenPlates}
                onAddBlackPlate={handleAddBlackPlate}
                onRemoveImage={(imgId) => {
                  pushUndo(project);
                  const updated: BeatProject = {
                    ...project,
                    images: project.images.filter((i) => i.id !== imgId),
                    patternImageIds: project.patternImageIds.filter((id) => id !== imgId),
                    beats: project.beats.map((b) =>
                      b.assignedImageId === imgId ? { ...b, assignedImageId: null } : b,
                    ),
                  };
                  setProject(updated);
                  void persistProject(updated, waveformPeaks);
                }}
                onSelectDetectionMode={(mode) => {
                  const updated = { ...project, detectionMode: mode };
                  setProject(updated);
                  void persistProject(updated, waveformPeaks);
                }}
                onSensitivityChange={(val) => setProject((p) => ({ ...p, sensitivity: val }))}
                onRunDetection={handleRunDetection}
                onTapBeatLive={() => addBeatAt(positionMs)}
                onNudgeSelected={(deltaMs) => {
                  if (!selectedBeat) return;
                  pushUndo(project);
                  const nextBeats = project.beats
                    .map((b) =>
                      b.id === selectedBeat.id
                        ? {
                            ...b,
                            timestampMs: Math.max(
                              0,
                              Math.min(project.durationMs, b.timestampMs + deltaMs),
                            ),
                          }
                        : b,
                    )
                    .sort((a, b) => a.timestampMs - b.timestampMs);
                  const updated = {
                    ...project,
                    beats: nextBeats,
                    estimatedBpm: recalcBpm(nextBeats, project.estimatedBpm),
                  };
                  setProject(updated);
                  void persistProject(updated, waveformPeaks);
                }}
                onDeleteSelected={() => {
                  if (!selectedBeat) return;
                  pushUndo(project);
                  const idx = project.beats.findIndex((b) => b.id === selectedBeat.id);
                  const nextBeats = project.beats.filter((b) => b.id !== selectedBeat.id);
                  const updated = {
                    ...project,
                    beats: nextBeats,
                    estimatedBpm: recalcBpm(nextBeats, project.estimatedBpm),
                  };
                  setProject(updated);
                  setSelectedBeatId(nextBeats[Math.min(idx, nextBeats.length - 1)]?.id ?? null);
                  void persistProject(updated, waveformPeaks);
                }}
                onClearAllBeats={() => {
                  if (project.beats.length === 0) return;
                  pushUndo(project);
                  const updated = { ...project, beats: [], estimatedBpm: 0 };
                  setProject(updated);
                  setSelectedBeatId(null);
                  void persistProject(updated, waveformPeaks);
                }}
                onToggleSnap={() => setSnapToPeak((s) => !s)}
                onAssignImageToSelected={(imgId) => {
                  if (!selectedBeat) return;
                  pushUndo(project);
                  const nextBeats = project.beats.map((b) =>
                    b.id === selectedBeat.id ? { ...b, assignedImageId: imgId } : b,
                  );
                  const updated = { ...project, beats: nextBeats };
                  setProject(updated);
                  void persistProject(updated, waveformPeaks);
                }}
                onSelectedDurationChange={(mode, customMs) => {
                  if (!selectedBeat) return;
                  pushUndo(project);
                  const nextBeats = project.beats.map((b) =>
                    b.id === selectedBeat.id
                      ? { ...b, durationMode: mode, customDurationMs: customMs ?? b.customDurationMs }
                      : b,
                  );
                  const updated = { ...project, beats: nextBeats };
                  setProject(updated);
                  void persistProject(updated, waveformPeaks);
                }}
                onAppendPatternImage={(imgId) => {
                  const updated = {
                    ...project,
                    patternImageIds: [...project.patternImageIds, imgId],
                  };
                  setProject(updated);
                  void persistProject(updated, waveformPeaks);
                }}
                onRemovePatternStep={(stepIdx) => {
                  const next = [...project.patternImageIds];
                  next.splice(stepIdx, 1);
                  const updated = { ...project, patternImageIds: next };
                  setProject(updated);
                  void persistProject(updated, waveformPeaks);
                }}
                onClearPattern={() => {
                  const updated = { ...project, patternImageIds: [] };
                  setProject(updated);
                  void persistProject(updated, waveformPeaks);
                }}
                onPatternDurationChange={(mode, customMs) => {
                  const updated = {
                    ...project,
                    patternDurationMode: mode,
                    patternCustomDurationMs: customMs ?? project.patternCustomDurationMs,
                  };
                  setProject(updated);
                  void persistProject(updated, waveformPeaks);
                }}
                onApplyPatternToAll={() => {
                  if (project.beats.length === 0 || project.patternImageIds.length === 0) return;
                  pushUndo(project);
                  const nextBeats = applyPatternToBeats(
                    project.beats,
                    project.patternImageIds,
                    project.patternDurationMode,
                    project.patternCustomDurationMs,
                  );
                  const updated = { ...project, beats: nextBeats };
                  setProject(updated);
                  setInfoMessage(
                    `Applied ${project.patternImageIds.length}-step pattern across ${nextBeats.length} beats`,
                  );
                  void persistProject(updated, waveformPeaks);
                }}
                onClearAllAssignments={() => {
                  pushUndo(project);
                  const updated = {
                    ...project,
                    beats: project.beats.map((b) => ({ ...b, assignedImageId: null })),
                  };
                  setProject(updated);
                  void persistProject(updated, waveformPeaks);
                }}
                onSelectResolution={setExportResolution}
                onSelectFps={setExportFps}
                onSelectAspectRatio={(ratio) => {
                  const updated = { ...project, aspectRatio: ratio };
                  setProject(updated);
                  void persistProject(updated, waveformPeaks);
                }}
                onExportMp4={handleExportMp4}
                onExportXml={handleExportXml}
                onExportBundleZip={handleExportBundleZip}
                onExportCsv={handleExportCsv}
                onExportJson={handleExportJson}
              />
            </div>
          </div>
        </div>

        {/* Transport Bar */}
        <div className="flex h-12 shrink-0 items-center justify-between border-t border-[#28332E] bg-[#121715] px-3">
          <div className="flex flex-col">
            <span className="font-mono-tnum text-xs text-white">
              {formatTimecode(positionMs)} / {formatShortTimecode(project.durationMs)}
            </span>
            <span className="font-mono-tnum text-[10px] font-medium text-[#16E575]">
              {project.estimatedBpm > 0 ? `${project.estimatedBpm} BPM · ` : ''}
              {project.beats.length} beats
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!project.audioBlob}
              onClick={() => {
                const prev = [...project.beats]
                  .reverse()
                  .find((b) => b.timestampMs < positionMs - 80);
                if (prev) playFromBeat(prev);
                else seekTo(0);
              }}
              aria-label="Previous beat"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-white hover:bg-[#1A221F] disabled:opacity-30"
            >
              <SkipBack className="h-4 w-4" />
            </button>

            <button
              type="button"
              disabled={!project.audioBlob}
              onClick={togglePlayPause}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
                project.audioBlob
                  ? 'bg-[#16E575] text-[#0A0D0C] hover:bg-[#1de97b]'
                  : 'bg-[#1A221F] text-[#69766F]'
              }`}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
            </button>

            <button
              type="button"
              disabled={!project.audioBlob}
              onClick={() => {
                const next = project.beats.find((b) => b.timestampMs > positionMs + 30);
                if (next) playFromBeat(next);
              }}
              aria-label="Next beat"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-white hover:bg-[#1A221F] disabled:opacity-30"
            >
              <SkipForward className="h-4 w-4" />
            </button>
          </div>

          <button
            type="button"
            disabled={!project.audioBlob}
            onClick={() => addBeatAt(positionMs)}
            className="flex min-h-[34px] items-center gap-1 rounded-lg border border-[#28332E] bg-[#1A221F] px-2.5 text-xs font-semibold text-white hover:border-[#16E575] disabled:opacity-30"
          >
            <Plus className="h-3.5 w-3.5 text-[#16E575]" />
            <span>Beat</span>
          </button>
        </div>

        {/* Beat Marker & Waveform Timeline */}
        <BeatTimeline
          durationMs={project.durationMs}
          positionMs={positionMs}
          isPlaying={isPlaying}
          waveformPeaks={waveformPeaks}
          beats={project.beats}
          images={project.images}
          selectedBeatId={selectedBeatId}
          manualModeActive={project.detectionMode === 'MANUAL'}
          onSeek={seekTo}
          onSelectBeat={(b) => setSelectedBeatId(b.id)}
          onPlayFromBeat={playFromBeat}
          onAddBeatAt={addBeatAt}
          onBeginDragBeat={() => pushUndo(project)}
          onMoveBeat={(id, ms) => {
            setProject((prev) => ({
              ...prev,
              beats: prev.beats
                .map((b) => (b.id === id ? { ...b, timestampMs: ms } : b))
                .sort((a, b) => a.timestampMs - b.timestampMs),
            }));
          }}
          onEndDragBeat={() => {
            setProject((prev) => {
              const updated = {
                ...prev,
                estimatedBpm: recalcBpm(prev.beats, prev.estimatedBpm),
              };
              void persistProject(updated, waveformPeaks);
              return updated;
            });
          }}
        />

        {/* Inline Status / Error Banner */}
        {(errorMessage || infoMessage) && (
          <div
            className={`flex shrink-0 items-center justify-between gap-2 px-3 py-1.5 text-xs ${
              errorMessage
                ? 'bg-[#FF5252]/15 text-[#FF5252]'
                : 'bg-[#132E20] text-[#16E575]'
            }`}
          >
            <span className="truncate">{errorMessage || infoMessage}</span>
            <button
              type="button"
              onClick={() => {
                setErrorMessage(null);
                setInfoMessage(null);
              }}
              aria-label="Dismiss message"
              className="shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Mobile Dock Panel + Thumb-Zone Tabs */}
        <div className="flex flex-1 min-h-0 flex-col lg:hidden">
          <div className="flex-1 min-h-0 overflow-hidden bg-[#0A0D0C]">
            <ControlDock
              activeTab={activeTab}
              project={project}
              selectedBeat={selectedBeat}
              positionMs={positionMs}
              snapToPeak={snapToPeak}
              aiMusicalNotes={aiMusicalNotes}
              exportResolution={exportResolution}
              exportFps={exportFps}
              onPickMedia={() => mediaInputRef.current?.click()}
              onPickImages={() => imageInputRef.current?.click()}
              onAddWhiteAndGreenPlates={handleAddWhiteAndGreenPlates}
              onAddBlackPlate={handleAddBlackPlate}
              onRemoveImage={(imgId) => {
                pushUndo(project);
                const updated: BeatProject = {
                  ...project,
                  images: project.images.filter((i) => i.id !== imgId),
                  patternImageIds: project.patternImageIds.filter((id) => id !== imgId),
                  beats: project.beats.map((b) =>
                    b.assignedImageId === imgId ? { ...b, assignedImageId: null } : b,
                  ),
                };
                setProject(updated);
                void persistProject(updated, waveformPeaks);
              }}
              onSelectDetectionMode={(mode) => {
                const updated = { ...project, detectionMode: mode };
                setProject(updated);
                void persistProject(updated, waveformPeaks);
              }}
              onSensitivityChange={(val) => setProject((p) => ({ ...p, sensitivity: val }))}
              onRunDetection={handleRunDetection}
              onTapBeatLive={() => addBeatAt(positionMs)}
              onNudgeSelected={(deltaMs) => {
                if (!selectedBeat) return;
                pushUndo(project);
                const nextBeats = project.beats
                  .map((b) =>
                    b.id === selectedBeat.id
                      ? {
                          ...b,
                          timestampMs: Math.max(
                            0,
                            Math.min(project.durationMs, b.timestampMs + deltaMs),
                          ),
                        }
                      : b,
                  )
                  .sort((a, b) => a.timestampMs - b.timestampMs);
                const updated = {
                  ...project,
                  beats: nextBeats,
                  estimatedBpm: recalcBpm(nextBeats, project.estimatedBpm),
                };
                setProject(updated);
                void persistProject(updated, waveformPeaks);
              }}
              onDeleteSelected={() => {
                if (!selectedBeat) return;
                pushUndo(project);
                const idx = project.beats.findIndex((b) => b.id === selectedBeat.id);
                const nextBeats = project.beats.filter((b) => b.id !== selectedBeat.id);
                const updated = {
                  ...project,
                  beats: nextBeats,
                  estimatedBpm: recalcBpm(nextBeats, project.estimatedBpm),
                };
                setProject(updated);
                setSelectedBeatId(nextBeats[Math.min(idx, nextBeats.length - 1)]?.id ?? null);
                void persistProject(updated, waveformPeaks);
              }}
              onClearAllBeats={() => {
                if (project.beats.length === 0) return;
                pushUndo(project);
                const updated = { ...project, beats: [], estimatedBpm: 0 };
                setProject(updated);
                setSelectedBeatId(null);
                void persistProject(updated, waveformPeaks);
              }}
              onToggleSnap={() => setSnapToPeak((s) => !s)}
              onAssignImageToSelected={(imgId) => {
                if (!selectedBeat) return;
                pushUndo(project);
                const nextBeats = project.beats.map((b) =>
                  b.id === selectedBeat.id ? { ...b, assignedImageId: imgId } : b,
                );
                const updated = { ...project, beats: nextBeats };
                setProject(updated);
                void persistProject(updated, waveformPeaks);
              }}
              onSelectedDurationChange={(mode, customMs) => {
                if (!selectedBeat) return;
                pushUndo(project);
                const nextBeats = project.beats.map((b) =>
                  b.id === selectedBeat.id
                    ? { ...b, durationMode: mode, customDurationMs: customMs ?? b.customDurationMs }
                    : b,
                );
                const updated = { ...project, beats: nextBeats };
                setProject(updated);
                void persistProject(updated, waveformPeaks);
              }}
              onAppendPatternImage={(imgId) => {
                const updated = {
                  ...project,
                  patternImageIds: [...project.patternImageIds, imgId],
                };
                setProject(updated);
                void persistProject(updated, waveformPeaks);
              }}
              onRemovePatternStep={(stepIdx) => {
                const next = [...project.patternImageIds];
                next.splice(stepIdx, 1);
                const updated = { ...project, patternImageIds: next };
                setProject(updated);
                void persistProject(updated, waveformPeaks);
              }}
              onClearPattern={() => {
                const updated = { ...project, patternImageIds: [] };
                setProject(updated);
                void persistProject(updated, waveformPeaks);
              }}
              onPatternDurationChange={(mode, customMs) => {
                const updated = {
                  ...project,
                  patternDurationMode: mode,
                  patternCustomDurationMs: customMs ?? project.patternCustomDurationMs,
                };
                setProject(updated);
                void persistProject(updated, waveformPeaks);
              }}
              onApplyPatternToAll={() => {
                if (project.beats.length === 0 || project.patternImageIds.length === 0) return;
                pushUndo(project);
                const nextBeats = applyPatternToBeats(
                  project.beats,
                  project.patternImageIds,
                  project.patternDurationMode,
                  project.patternCustomDurationMs,
                );
                const updated = { ...project, beats: nextBeats };
                setProject(updated);
                setInfoMessage(
                  `Applied ${project.patternImageIds.length}-step pattern across ${nextBeats.length} beats`,
                );
                void persistProject(updated, waveformPeaks);
              }}
              onClearAllAssignments={() => {
                pushUndo(project);
                const updated = {
                  ...project,
                  beats: project.beats.map((b) => ({ ...b, assignedImageId: null })),
                };
                setProject(updated);
                void persistProject(updated, waveformPeaks);
              }}
              onSelectResolution={setExportResolution}
              onSelectFps={setExportFps}
              onSelectAspectRatio={(ratio) => {
                const updated = { ...project, aspectRatio: ratio };
                setProject(updated);
                void persistProject(updated, waveformPeaks);
              }}
              onExportMp4={handleExportMp4}
              onExportXml={handleExportXml}
              onExportBundleZip={handleExportBundleZip}
              onExportCsv={handleExportCsv}
              onExportJson={handleExportJson}
            />
          </div>

          <nav className="grid h-14 shrink-0 grid-cols-4 border-t border-[#28332E] bg-[#121715]">
            <BottomTabBtn
              icon={<Music className="h-5 w-5" />}
              label="Media"
              active={activeTab === 'IMPORT'}
              onClick={() => setActiveTab('IMPORT')}
            />
            <BottomTabBtn
              icon={<Sparkles className="h-5 w-5" />}
              label="Detect"
              active={activeTab === 'DETECT'}
              onClick={() => setActiveTab('DETECT')}
            />
            <BottomTabBtn
              icon={<LayoutGrid className="h-5 w-5" />}
              label="Pattern"
              active={activeTab === 'PATTERN'}
              onClick={() => setActiveTab('PATTERN')}
            />
            <BottomTabBtn
              icon={<Share2 className="h-5 w-5" />}
              label="Export"
              active={activeTab === 'EXPORT'}
              onClick={() => setActiveTab('EXPORT')}
            />
          </nav>
        </div>
      </div>

      {/* Busy Processing Modal */}
      {isBusy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6">
          <div className="flex w-full max-w-xs flex-col items-center gap-3 rounded-2xl border border-[#16E575]/50 bg-[#121715] p-5 text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#28332E] border-t-[#16E575]" />
            <div className="text-sm font-semibold text-white">
              {busyMessage || 'Processing...'}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#28332E]">
              <div
                className="h-full bg-[#16E575] transition-all duration-200"
                style={{ width: `${Math.round(busyProgress * 100)}%` }}
              />
            </div>
            <div className="font-mono-tnum text-xs text-[#9BA8A1]">
              {Math.round(busyProgress * 100)}%
            </div>
          </div>
        </div>
      )}

      <ProjectsModal
        open={projectsOpen}
        currentProjectId={project.id}
        currentTitle={project.title}
        projects={savedProjects}
        onClose={() => setProjectsOpen(false)}
        onCreateNew={() => {
          audioRef.current?.pause();
          setIsPlaying(false);
          envelopeFramesRef.current = [];
          setWaveformPeaks(new Float32Array(0));
          setUndoStack([]);
          setRedoStack([]);
          setSelectedBeatId(null);
          setProject(createEmptyProject('New Beat Edit'));
          setActiveTab('IMPORT');
        }}
        onRenameCurrent={(title) => {
          const clean = title.trim();
          if (!clean) return;
          const updated = { ...project, title: clean };
          setProject(updated);
          void persistProject(updated, waveformPeaks);
        }}
        onSelectProject={async (id) => {
          const loaded = await loadProjectFromDb(id);
          if (!loaded) return;
          audioRef.current?.pause();
          setIsPlaying(false);
          envelopeFramesRef.current = [];
          setUndoStack([]);
          setRedoStack([]);
          setProject(loaded.project);
          setWaveformPeaks(loaded.waveformPeaks);
          setSelectedBeatId(loaded.project.beats[0]?.id ?? null);
        }}
        onDeleteProject={async (id) => {
          await deleteProjectFromDb(id);
          const remaining = await listProjectSummaries();
          setSavedProjects(remaining);
          if (id === project.id) {
            if (remaining.length > 0) {
              const loaded = await loadProjectFromDb(remaining[0].id);
              if (loaded) {
                setProject(loaded.project);
                setWaveformPeaks(loaded.waveformPeaks);
                setSelectedBeatId(loaded.project.beats[0]?.id ?? null);
                return;
              }
            }
            setProject(createEmptyProject('New Beat Edit'));
            setWaveformPeaks(new Float32Array(0));
            setSelectedBeatId(null);
          }
        }}
      />
    </div>
  );
}

const BottomTabBtn: React.FC<{
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}> = ({ icon, label, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex flex-col items-center justify-center gap-0.5 transition-colors ${
      active ? 'text-[#16E575]' : 'text-[#9BA8A1] hover:text-white'
    }`}
  >
    {icon}
    <span className="text-[11px] font-semibold">{label}</span>
  </button>
);
