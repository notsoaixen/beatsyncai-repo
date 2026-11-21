import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import {
  BeatMarker,
  BeatType,
  ImageAsset,
  formatShortTimecode,
  formatTimecode,
  resolveBeatImageWindow,
} from '../types/beatsync';

interface BeatTimelineProps {
  durationMs: number;
  positionMs: number;
  isPlaying: boolean;
  waveformPeaks: Float32Array;
  beats: BeatMarker[];
  images: ImageAsset[];
  selectedBeatId: string | null;
  manualModeActive: boolean;
  onSeek: (ms: number) => void;
  onSelectBeat: (beat: BeatMarker) => void;
  onPlayFromBeat: (beat: BeatMarker) => void;
  onAddBeatAt: (ms: number) => void;
  onBeginDragBeat: () => void;
  onMoveBeat: (id: string, ms: number) => void;
  onEndDragBeat: () => void;
}

function pickTickIntervalMs(visibleSpanMs: number): number {
  if (visibleSpanMs <= 3000) return 500;
  if (visibleSpanMs <= 8000) return 1000;
  if (visibleSpanMs <= 20000) return 2000;
  if (visibleSpanMs <= 60000) return 5000;
  if (visibleSpanMs <= 150000) return 15000;
  return 30000;
}

function getBeatColor(type: BeatType): string {
  switch (type) {
    case 'KICK':
      return '#16E575';
    case 'SNARE_CLAP':
      return '#FFFFFF';
    case 'DROP':
      return '#A3FF33';
    case 'ACCENT':
      return '#38E8B0';
    case 'MANUAL':
      return '#E2F8EE';
  }
}

export const BeatTimeline: React.FC<BeatTimelineProps> = ({
  durationMs,
  positionMs,
  isPlaying,
  waveformPeaks,
  beats,
  images,
  selectedBeatId,
  manualModeActive,
  onSeek,
  onSelectBeat,
  onPlayFromBeat,
  onAddBeatAt,
  onBeginDragBeat,
  onMoveBeat,
  onEndDragBeat,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [viewportWidth, setViewportWidth] = useState(360);
  const [zoom, setZoom] = useState(2.5);
  const [scrollOffsetPx, setScrollOffsetPx] = useState(0);

  const dragStateRef = useRef<{
    mode: 'none' | 'pan' | 'beat';
    beatId: string | null;
    startX: number;
    startScroll: number;
    startBeatMs: number;
    moved: boolean;
  }>({
    mode: 'none',
    beatId: null,
    startX: 0,
    startScroll: 0,
    startBeatMs: 0,
    moved: false,
  });

  const safeDurationMs = Math.max(1000, durationMs);
  const totalWidthPx = viewportWidth * zoom;
  const maxScrollPx = Math.max(0, totalWidthPx - viewportWidth);
  const pxPerMs = totalWidthPx / safeDurationMs;

  const imageById = useMemo(() => new Map(images.map((i) => [i.id, i])), [images]);
  const selectedBeat = useMemo(
    () => beats.find((b) => b.id === selectedBeatId) ?? null,
    [beats, selectedBeatId],
  );

  // Measure timeline width cleanly
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setViewportWidth(entry.contentRect.width);
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Clamp scroll offset when zoom shrinks
  useEffect(() => {
    if (scrollOffsetPx > maxScrollPx) {
      setScrollOffsetPx(maxScrollPx);
    }
  }, [maxScrollPx, scrollOffsetPx]);

  // Auto-follow playhead while playing
  useEffect(() => {
    if (!isPlaying || dragStateRef.current.mode !== 'none') return;
    const playX = positionMs * pxPerMs;
    const margin = viewportWidth * 0.25;
    if (playX < scrollOffsetPx || playX > scrollOffsetPx + viewportWidth - margin) {
      setScrollOffsetPx(Math.max(0, Math.min(maxScrollPx, playX - viewportWidth * 0.2)));
    }
  }, [isPlaying, positionMs, pxPerMs, viewportWidth, scrollOffsetPx, maxScrollPx]);

  // Render ruler + waveform + beat markers + playhead on high-DPI canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const height = 132;
    canvas.width = Math.round(viewportWidth * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    const w = viewportWidth;
    const rulerH = 24;
    const waveTop = rulerH + 4;
    const waveBottom = height - 4;
    const waveCenterY = (waveTop + waveBottom) / 2;
    const waveHalfH = (waveBottom - waveTop) / 2;

    // Track background
    ctx.fillStyle = '#141B18';
    ctx.fillRect(0, 0, w, height);

    // Ruler background
    ctx.fillStyle = '#0A0D0C';
    ctx.fillRect(0, 0, w, rulerH);
    ctx.strokeStyle = '#28332E';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, rulerH);
    ctx.lineTo(w, rulerH);
    ctx.stroke();

    // Ruler ticks & timestamps
    const visStartMs = (scrollOffsetPx / totalWidthPx) * safeDurationMs;
    const visEndMs = ((scrollOffsetPx + w) / totalWidthPx) * safeDurationMs;
    const tickStepMs = pickTickIntervalMs(Math.max(100, visEndMs - visStartMs));
    const firstTick = Math.floor(visStartMs / tickStepMs) * tickStepMs;

    ctx.font = '500 10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#69766F';
    ctx.strokeStyle = '#28332E';
    for (let t = firstTick; t <= visEndMs; t += tickStepMs) {
      const x = t * pxPerMs - scrollOffsetPx;
      if (x < 0 || x > w) continue;
      ctx.beginPath();
      ctx.moveTo(x, rulerH * 0.45);
      ctx.lineTo(x, rulerH);
      ctx.stroke();
      if (x < w - 44) {
        ctx.fillText(formatShortTimecode(t), x + 4, 15);
      }
    }

    // Center zero-line
    ctx.strokeStyle = 'rgba(40, 51, 46, 0.7)';
    ctx.beginPath();
    ctx.moveTo(0, waveCenterY);
    ctx.lineTo(w, waveCenterY);
    ctx.stroke();

    // Waveform bars (visible region only for low CPU/RAM on Android)
    const playX = positionMs * pxPerMs - scrollOffsetPx;
    if (waveformPeaks.length > 0) {
      const nPeaks = waveformPeaks.length;
      const stepPx = 3;
      for (let sx = 0; sx < w; sx += stepPx) {
        const absRatio = Math.min(0.9999, Math.max(0, (scrollOffsetPx + sx) / totalWidthPx));
        const idx = Math.floor(absRatio * nPeaks);
        const amp = Math.max(0.03, Math.min(1, waveformPeaks[idx] || 0));
        const halfBar = amp * waveHalfH * 0.88;
        ctx.fillStyle = sx <= playX ? 'rgba(22, 229, 117, 0.85)' : '#3E5047';
        ctx.fillRect(sx, waveCenterY - halfBar, 2, halfBar * 2);
      }
    }

    // Beat markers + timestamps
    let lastLabelX = -1000;
    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i];
      const bx = beat.timestampMs * pxPerMs - scrollOffsetPx;
      if (bx < -12 || bx > w + 12) continue;

      const isSelected = beat.id === selectedBeatId;
      const color = isSelected ? '#FFFFFF' : getBeatColor(beat.type);

      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.moveTo(bx, rulerH);
      ctx.lineTo(bx, height);
      ctx.stroke();

      // Top diamond marker handle
      const r = isSelected ? 6.5 : 5;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(bx, rulerH - r * 1.2);
      ctx.lineTo(bx + r, rulerH);
      ctx.lineTo(bx, rulerH + r * 0.9);
      ctx.lineTo(bx - r, rulerH);
      ctx.closePath();
      ctx.fill();

      // Timestamp tag next to marker when spaced or selected
      if (isSelected || bx - lastLabelX >= 70) {
        lastLabelX = bx;
        const label = formatShortTimecode(beat.timestampMs);
        ctx.font = `${isSelected ? '700' : '500'} 9px "JetBrains Mono", monospace`;
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(10, 13, 12, 0.85)';
        ctx.fillRect(bx + 3, rulerH + 4, tw + 6, 13);
        ctx.fillStyle = isSelected ? '#FFFFFF' : '#16E575';
        ctx.fillText(label, bx + 6, rulerH + 14);
      }
    }

    // Playhead cursor
    if (playX >= -4 && playX <= w + 4) {
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playX, 0);
      ctx.lineTo(playX, height);
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.moveTo(playX - 6, 0);
      ctx.lineTo(playX + 6, 0);
      ctx.lineTo(playX, 10);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }, [
    viewportWidth,
    totalWidthPx,
    scrollOffsetPx,
    safeDurationMs,
    pxPerMs,
    positionMs,
    waveformPeaks,
    beats,
    selectedBeatId,
  ]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      const absX = scrollOffsetPx + localX;
      const hitMs = Math.max(0, Math.min(safeDurationMs, absX / pxPerMs));
      const hitRadiusMs = Math.max(40, 18 / pxPerMs);

      let nearest: BeatMarker | null = null;
      let nearestDist = Infinity;
      for (const b of beats) {
        const d = Math.abs(b.timestampMs - hitMs);
        if (d <= hitRadiusMs && d < nearestDist) {
          nearestDist = d;
          nearest = b;
        }
      }

      e.currentTarget.setPointerCapture(e.pointerId);

      if (nearest && (localY <= 48 || nearest.id === selectedBeatId)) {
        dragStateRef.current = {
          mode: 'beat',
          beatId: nearest.id,
          startX: e.clientX,
          startScroll: scrollOffsetPx,
          startBeatMs: nearest.timestampMs,
          moved: false,
        };
        onSelectBeat(nearest);
        onBeginDragBeat();
      } else {
        dragStateRef.current = {
          mode: 'pan',
          beatId: nearest?.id ?? null,
          startX: e.clientX,
          startScroll: scrollOffsetPx,
          startBeatMs: hitMs,
          moved: false,
        };
      }
    },
    [beats, onBeginDragBeat, onSelectBeat, pxPerMs, safeDurationMs, scrollOffsetPx, selectedBeatId],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const ds = dragStateRef.current;
      if (ds.mode === 'none') return;
      const dx = e.clientX - ds.startX;
      if (Math.abs(dx) > 4) ds.moved = true;

      if (ds.mode === 'beat' && ds.beatId) {
        const nextMs = Math.round(ds.startBeatMs + dx / pxPerMs);
        onMoveBeat(ds.beatId, Math.max(0, Math.min(safeDurationMs, nextMs)));
      } else if (ds.mode === 'pan' && ds.moved) {
        setScrollOffsetPx(Math.max(0, Math.min(maxScrollPx, ds.startScroll - dx)));
      }
    },
    [maxScrollPx, onMoveBeat, pxPerMs, safeDurationMs],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const ds = dragStateRef.current;
      if (ds.mode === 'none') return;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }

      if (ds.mode === 'beat') {
        if (!ds.moved && ds.beatId) {
          const b = beats.find((item) => item.id === ds.beatId);
          if (b) onPlayFromBeat(b);
        }
        onEndDragBeat();
      } else if (ds.mode === 'pan' && !ds.moved) {
        if (ds.beatId) {
          const b = beats.find((item) => item.id === ds.beatId);
          if (b) onPlayFromBeat(b);
        } else {
          const rect = e.currentTarget.getBoundingClientRect();
          const localY = e.clientY - rect.top;
          if (manualModeActive && localY > 26) {
            onAddBeatAt(Math.round(ds.startBeatMs));
          } else {
            onSeek(Math.round(ds.startBeatMs));
          }
        }
      }

      dragStateRef.current.mode = 'none';
    },
    [beats, manualModeActive, onAddBeatAt, onEndDragBeat, onPlayFromBeat, onSeek],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
        setZoom((z) => Math.max(1, Math.min(24, z * factor)));
      } else {
        setScrollOffsetPx((s) => Math.max(0, Math.min(maxScrollPx, s + e.deltaX)));
      }
    },
    [maxScrollPx],
  );

  // Visible image blocks on the strip track
  const visibleImageBlocks = useMemo(() => {
    const blocks: Array<{
      beat: BeatMarker;
      name: string;
      url: string;
      leftPx: number;
      widthPx: number;
    }> = [];
    beats.forEach((beat, idx) => {
      if (!beat.assignedImageId) return;
      const img = imageById.get(beat.assignedImageId);
      if (!img) return;
      const { startMs, endMs } = resolveBeatImageWindow(beats, idx, safeDurationMs);
      const leftPx = startMs * pxPerMs - scrollOffsetPx;
      const rightPx = endMs * pxPerMs - scrollOffsetPx;
      if (rightPx >= -4 && leftPx <= viewportWidth + 4) {
        blocks.push({
          beat,
          name: img.name,
          url: img.objectUrl,
          leftPx,
          widthPx: Math.max(18, rightPx - leftPx),
        });
      }
    });
    return blocks;
  }, [beats, imageById, pxPerMs, safeDurationMs, scrollOffsetPx, viewportWidth]);

  const selectedIndex = selectedBeat
    ? beats.findIndex((b) => b.id === selectedBeat.id) + 1
    : -1;

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      className="flex w-full flex-col border-y border-[#28332E] bg-[#121715] select-none"
    >
      {/* Timeline header: selected marker readout + zoom controls */}
      <div className="flex items-center justify-between bg-[#0A0D0C] px-3 py-1.5 text-xs">
        {selectedBeat ? (
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono-tnum font-bold text-[#16E575]">#{selectedIndex}</span>
            <span className="font-mono-tnum text-white">
              {formatTimecode(selectedBeat.timestampMs)}
            </span>
            <span className="truncate text-[#9BA8A1]">
              {selectedBeat.type.replace('_', ' / ')}
            </span>
          </div>
        ) : (
          <span className="text-[#9BA8A1]">
            {beats.length > 0 ? `${beats.length} beat markers` : 'Tap timeline to seek'}
          </span>
        )}

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(1, z / 1.4))}
            className="flex h-7 w-7 items-center justify-center rounded border border-[#28332E] bg-[#1A221F] text-white hover:border-[#16E575]"
            aria-label="Zoom out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="font-mono-tnum w-10 text-center text-[11px] text-[#9BA8A1]">
            {zoom.toFixed(1)}x
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(24, z * 1.4))}
            className="flex h-7 w-7 items-center justify-center rounded border border-[#28332E] bg-[#1A221F] text-white hover:border-[#16E575]"
            aria-label="Zoom in"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              setScrollOffsetPx(0);
            }}
            className="flex h-7 w-7 items-center justify-center rounded border border-[#28332E] bg-[#1A221F] text-white hover:border-[#16E575]"
            aria-label="Fit timeline"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Waveform + Beat Markers Canvas */}
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="block h-[132px] w-full touch-none cursor-crosshair"
      />

      {/* Image Assignment Sequence Strip */}
      <div className="relative h-[50px] w-full overflow-hidden border-t border-[#28332E] bg-[#0D1210]">
        {visibleImageBlocks.length === 0 && beats.every((b) => !b.assignedImageId) ? (
          <div className="flex h-full items-center px-3 text-[11px] text-[#69766F]">
            Image strip — assign images or apply an alternating pattern in Pattern tab
          </div>
        ) : (
          visibleImageBlocks.map((block) => {
            const isSelected = block.beat.id === selectedBeatId;
            return (
              <button
                key={block.beat.id}
                type="button"
                onClick={() => onSelectBeat(block.beat)}
                style={{
                  transform: `translateX(${block.leftPx}px)`,
                  width: `${block.widthPx}px`,
                }}
                className={`absolute top-1 left-0 h-[40px] overflow-hidden rounded border text-left transition-colors ${
                  isSelected
                    ? 'border-white ring-1 ring-white'
                    : 'border-[#16E575]/60 hover:border-[#16E575]'
                }`}
              >
                <img
                  src={block.url}
                  alt={block.name}
                  className="h-full w-full object-cover"
                  draggable={false}
                />
                <span className="absolute bottom-0 left-0 right-0 truncate bg-black/70 px-1 py-0.5 text-[9px] text-white">
                  {block.name}
                </span>
              </button>
            );
          })
        )}

        {/* Playhead hairline across image track */}
        <div
          style={{ transform: `translateX(${positionMs * pxPerMs - scrollOffsetPx}px)` }}
          className="pointer-events-none absolute top-0 bottom-0 left-0 w-[2px] bg-white/85"
        />
      </div>
    </div>
  );
};
