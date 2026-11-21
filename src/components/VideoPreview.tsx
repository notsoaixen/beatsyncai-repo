import React, { useMemo } from 'react';
import { AudioWaveform } from 'lucide-react';
import {
  AspectRatioPreset,
  BeatMarker,
  ImageAsset,
  resolveBeatImageWindow,
} from '../types/beatsync';

interface VideoPreviewProps {
  hasAudio: boolean;
  positionMs: number;
  durationMs: number;
  beats: BeatMarker[];
  images: ImageAsset[];
  aspectRatio: AspectRatioPreset;
  onCycleAspectRatio: () => void;
}

export const VideoPreview: React.FC<VideoPreviewProps> = ({
  hasAudio,
  positionMs,
  durationMs,
  beats,
  images,
  aspectRatio,
  onCycleAspectRatio,
}) => {
  const imageById = useMemo(() => new Map(images.map((img) => [img.id, img])), [images]);

  const active = useMemo(() => {
    let matchedImage: ImageAsset | null = null;
    let matchedBeatIdx = -1;
    for (let i = 0; i < beats.length; i++) {
      const imgId = beats[i].assignedImageId;
      if (!imgId) continue;
      const { startMs, endMs } = resolveBeatImageWindow(beats, i, durationMs);
      if (positionMs >= startMs && positionMs < endMs) {
        matchedImage = imageById.get(imgId) ?? null;
        matchedBeatIdx = i;
      }
    }
    return { matchedImage, matchedBeatIdx };
  }, [beats, durationMs, imageById, positionMs]);

  const ratioClass =
    aspectRatio === '9:16'
      ? 'aspect-[9/16] h-full max-h-full'
      : aspectRatio === '16:9'
        ? 'aspect-video w-full max-w-[380px] lg:max-w-[520px]'
        : 'aspect-square h-full max-h-full';

  return (
    <div className="relative flex w-full h-full items-center justify-center bg-[#0A0D0C] px-3 py-2 overflow-hidden">
      <div
        className={`relative flex items-center justify-center overflow-hidden rounded-lg border border-[#28332E] bg-black shadow-lg ${ratioClass}`}
        style={{
          backgroundImage:
            'linear-gradient(45deg, #0d1210 25%, transparent 25%), linear-gradient(-45deg, #0d1210 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #0d1210 75%), linear-gradient(-45deg, transparent 75%, #0d1210 75%)',
          backgroundSize: '20px 20px',
          backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
        }}
      >
        {active.matchedImage ? (
          <img
            src={active.matchedImage.objectUrl}
            alt={active.matchedImage.name}
            className="h-full w-full object-cover select-none"
            draggable={false}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 px-4 text-center">
            <AudioWaveform
              className={`h-7 w-7 ${hasAudio ? 'text-[#16E575]/80' : 'text-[#69766F]'}`}
            />
            <span className="text-xs font-medium text-[#9BA8A1]">
              {!hasAudio
                ? 'Import audio or video'
                : images.length === 0
                  ? 'Add images in Media or Pattern'
                  : 'Waiting for beat frame'}
            </span>
          </div>
        )}
      </div>

      {/* Aspect ratio button */}
      <button
        type="button"
        onClick={onCycleAspectRatio}
        className="font-mono-tnum absolute top-2 right-3 min-h-[34px] rounded-md border border-[#28332E] bg-[#121715]/95 px-2.5 py-1 text-xs font-semibold text-white hover:border-[#16E575] transition-colors whitespace-nowrap shrink-0"
        title="Switch preview aspect ratio"
      >
        {aspectRatio}
      </button>

      {/* Active beat label */}
      {active.matchedBeatIdx >= 0 && active.matchedImage && (
        <div className="absolute bottom-2 left-3 flex items-center gap-2 rounded-md border border-[#16E575]/50 bg-[#121715]/95 px-2.5 py-1 text-xs">
          <span className="font-mono-tnum font-bold text-[#16E575]">
            Beat {active.matchedBeatIdx + 1}
          </span>
          <span className="max-w-[140px] truncate text-white">{active.matchedImage.name}</span>
        </div>
      )}
    </div>
  );
};
