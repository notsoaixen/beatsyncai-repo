import React from 'react';
import {
  Download,
  FileCode2,
  FileSpreadsheet,
  Film,
  FolderArchive,
  ImagePlus,
  Music2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  AspectRatioPreset,
  BeatMarker,
  BeatProject,
  DetectionMode,
  DurationMode,
  ExportFps,
  ExportResolution,
  formatTimecode,
} from '../types/beatsync';

export type StudioTab = 'IMPORT' | 'DETECT' | 'PATTERN' | 'EXPORT';

interface ControlDockProps {
  activeTab: StudioTab;
  project: BeatProject;
  selectedBeat: BeatMarker | null;
  positionMs: number;
  snapToPeak: boolean;
  aiMusicalNotes: string;
  exportResolution: ExportResolution;
  exportFps: ExportFps;
  onPickMedia: () => void;
  onPickImages: () => void;
  onAddWhiteAndGreenPlates: () => void;
  onAddBlackPlate: () => void;
  onRemoveImage: (id: string) => void;
  onSelectDetectionMode: (mode: DetectionMode) => void;
  onSensitivityChange: (val: number) => void;
  onRunDetection: (mode: DetectionMode) => void;
  onTapBeatLive: () => void;
  onNudgeSelected: (deltaMs: number) => void;
  onDeleteSelected: () => void;
  onClearAllBeats: () => void;
  onToggleSnap: () => void;
  onAssignImageToSelected: (imageId: string | null) => void;
  onSelectedDurationChange: (mode: DurationMode, customMs?: number) => void;
  onAppendPatternImage: (imageId: string) => void;
  onRemovePatternStep: (index: number) => void;
  onClearPattern: () => void;
  onPatternDurationChange: (mode: DurationMode, customMs?: number) => void;
  onApplyPatternToAll: () => void;
  onClearAllAssignments: () => void;
  onSelectResolution: (res: ExportResolution) => void;
  onSelectFps: (fps: ExportFps) => void;
  onSelectAspectRatio: (ratio: AspectRatioPreset) => void;
  onExportMp4: () => void;
  onExportXml: () => void;
  onExportBundleZip: () => void;
  onExportCsv: () => void;
  onExportJson: () => void;
}

export const ControlDock: React.FC<ControlDockProps> = ({
  activeTab,
  project,
  selectedBeat,
  positionMs,
  snapToPeak,
  aiMusicalNotes,
  exportResolution,
  exportFps,
  onPickMedia,
  onPickImages,
  onAddWhiteAndGreenPlates,
  onAddBlackPlate,
  onRemoveImage,
  onSelectDetectionMode,
  onSensitivityChange,
  onRunDetection,
  onTapBeatLive,
  onNudgeSelected,
  onDeleteSelected,
  onClearAllBeats,
  onToggleSnap,
  onAssignImageToSelected,
  onSelectedDurationChange,
  onAppendPatternImage,
  onRemovePatternStep,
  onClearPattern,
  onPatternDurationChange,
  onApplyPatternToAll,
  onClearAllAssignments,
  onSelectResolution,
  onSelectFps,
  onSelectAspectRatio,
  onExportMp4,
  onExportXml,
  onExportBundleZip,
  onExportCsv,
  onExportJson,
}) => {
  const imageById = new Map(project.images.map((i) => [i.id, i]));

  if (activeTab === 'IMPORT') {
    return (
      <div className="flex flex-col gap-3 p-3 overflow-y-auto h-full">
        {/* Audio / Video Import */}
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[#28332E] bg-[#121715] p-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-white">
              {project.originalMediaName || 'Import Song or Video'}
            </div>
            <div className="truncate text-xs text-[#9BA8A1]">
              {project.audioBlob
                ? `${project.isExtractedFromVideo ? 'Extracted from video' : 'Audio track'} · ${formatTimecode(project.durationMs)} · ${project.estimatedBpm} BPM`
                : 'MP3, WAV, AAC, M4A, OGG, FLAC, MP4, MKV, WEBM'}
            </div>
          </div>
          <button
            type="button"
            onClick={onPickMedia}
            className="flex min-h-[44px] items-center gap-2 rounded-lg bg-[#16E575] px-4 py-2 text-xs font-bold text-[#0A0D0C] hover:bg-[#1de97b] transition-colors whitespace-nowrap shrink-0"
          >
            <Music2 className="h-4 w-4" />
            <span>{project.audioBlob ? 'Replace' : 'Import Media'}</span>
          </button>
        </div>

        {/* Images Import + Quick White/Green Plates */}
        <div className="flex flex-col gap-2.5 rounded-xl border border-[#28332E] bg-[#121715] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-white">
              Images ({project.images.length})
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onAddWhiteAndGreenPlates}
                className="min-h-[40px] rounded-lg border border-[#16E575]/60 bg-[#132E20] px-3 py-1.5 text-xs font-semibold text-[#16E575] hover:border-[#16E575] whitespace-nowrap shrink-0"
              >
                + White &amp; Green
              </button>
              <button
                type="button"
                onClick={onPickImages}
                className="flex min-h-[40px] items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-[#0A0D0C] hover:bg-neutral-200 whitespace-nowrap shrink-0"
              >
                <ImagePlus className="h-4 w-4" />
                <span>Add PNG/JPG</span>
              </button>
            </div>
          </div>

          {project.images.length === 0 ? (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-[#0A0D0C] p-3 text-xs text-[#9BA8A1]">
              <span>Import transparent PNG, JPG, JPEG or generate quick flash plates</span>
              <button
                type="button"
                onClick={onAddBlackPlate}
                className="rounded border border-[#28332E] px-2.5 py-1 text-xs font-medium text-white hover:border-[#16E575] shrink-0"
              >
                + Black
              </button>
            </div>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {project.images.map((img) => (
                <div
                  key={img.id}
                  className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-[#28332E] bg-[#0A0D0C]"
                >
                  <img
                    src={img.objectUrl}
                    alt={img.name}
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => onRemoveImage(img.id)}
                    aria-label={`Remove ${img.name}`}
                    className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/80 text-white hover:bg-[#FF5252]"
                  >
                    <X className="h-3 w-3" />
                  </button>
                  <div className="absolute right-0 bottom-0 left-0 truncate bg-black/75 px-1.5 py-0.5 text-[10px] text-white">
                    {img.name}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (activeTab === 'DETECT') {
    const modes: Array<{ id: DetectionMode; label: string; desc: string }> = [
      {
        id: 'STANDARD',
        label: 'Standard',
        desc: 'On-device multi-band rhythmic & DP beat tracker',
      },
      {
        id: 'ADVANCED_AI',
        label: 'Advanced AI',
        desc: 'Gemini AI musical structure & intelligent editor beat sync',
      },
      {
        id: 'MANUAL',
        label: 'Manual',
        desc: 'Tap beats live, tap timeline to add, or drag markers',
      },
    ];
    const activeDesc = modes.find((m) => m.id === project.detectionMode)?.desc ?? '';

    return (
      <div className="flex flex-col gap-3 p-3 overflow-y-auto h-full">
        {/* 3 Detection Modes */}
        <div className="grid grid-cols-3 gap-1 rounded-xl border border-[#28332E] bg-[#121715] p-1">
          {modes.map((m) => {
            const active = project.detectionMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onSelectDetectionMode(m.id)}
                className={`min-h-[42px] rounded-lg px-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                  active
                    ? 'border border-[#16E575] bg-[#132E20] text-[#16E575]'
                    : 'text-[#9BA8A1] hover:text-white'
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>

        {/* Standard / AI Detection Runner */}
        {project.detectionMode !== 'MANUAL' && (
          <div className="flex flex-col gap-2.5 rounded-xl border border-[#28332E] bg-[#121715] p-3">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-[#9BA8A1]">{activeDesc}</span>
              <span className="font-mono-tnum font-bold text-[#16E575]">
                {Math.round(project.sensitivity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0.1}
              max={0.95}
              step={0.05}
              value={project.sensitivity}
              onChange={(e) => onSensitivityChange(parseFloat(e.target.value))}
              className="w-full accent-[#16E575]"
              aria-label="Beat detection sensitivity"
            />
            {aiMusicalNotes && project.detectionMode === 'ADVANCED_AI' && (
              <div className="text-xs font-medium text-[#16E575]">
                Detected style: {aiMusicalNotes}
              </div>
            )}
            <button
              type="button"
              disabled={!project.audioBlob}
              onClick={() => onRunDetection(project.detectionMode)}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-[#16E575] px-4 py-2 text-sm font-bold text-[#0A0D0C] hover:bg-[#1de97b] disabled:opacity-40 transition-colors"
            >
              <Sparkles className="h-4 w-4" />
              <span>
                {project.detectionMode === 'ADVANCED_AI'
                  ? 'Analyze with Gemini AI'
                  : 'Detect Beats Now'}
              </span>
            </button>
          </div>
        )}

        {/* Manual Beat Adjustment Controls */}
        <div className="flex flex-col gap-2 rounded-xl border border-[#28332E] bg-[#121715] p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white">
              Marker Controls ({project.beats.length})
            </span>
            <button
              type="button"
              onClick={onToggleSnap}
              className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${
                snapToPeak
                  ? 'border-[#16E575] bg-[#132E20] text-[#16E575]'
                  : 'border-[#28332E] bg-[#1A221F] text-[#9BA8A1]'
              }`}
            >
              Snap to Peak: {snapToPeak ? 'ON' : 'OFF'}
            </button>
          </div>

          <div className="grid grid-cols-4 gap-2">
            <button
              type="button"
              disabled={!project.audioBlob}
              onClick={onTapBeatLive}
              className="col-span-2 flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-white px-3 text-xs font-bold text-[#0A0D0C] hover:bg-neutral-200 disabled:opacity-40 whitespace-nowrap"
            >
              <span className="font-mono-tnum">
                Tap Beat ({formatTimecode(positionMs).slice(-6)})
              </span>
            </button>
            <button
              type="button"
              disabled={!selectedBeat}
              onClick={() => onNudgeSelected(-10)}
              className="min-h-[44px] rounded-lg border border-[#28332E] bg-[#1A221F] text-xs font-semibold text-white hover:border-[#16E575] disabled:opacity-40"
            >
              -10ms
            </button>
            <button
              type="button"
              disabled={!selectedBeat}
              onClick={() => onNudgeSelected(10)}
              className="min-h-[44px] rounded-lg border border-[#28332E] bg-[#1A221F] text-xs font-semibold text-white hover:border-[#16E575] disabled:opacity-40"
            >
              +10ms
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!selectedBeat}
              onClick={onDeleteSelected}
              className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-[#FF5252]/40 bg-[#1A221F] text-xs font-semibold text-[#FF5252] disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Delete Marker</span>
            </button>
            <button
              type="button"
              disabled={project.beats.length === 0}
              onClick={onClearAllBeats}
              className="min-h-[40px] rounded-lg border border-[#28332E] bg-[#1A221F] text-xs font-semibold text-[#9BA8A1] hover:text-white disabled:opacity-40"
            >
              Clear All
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'PATTERN') {
    return (
      <div className="flex flex-col gap-3 p-3 overflow-y-auto h-full">
        {project.images.length === 0 ? (
          <div className="flex flex-col gap-3 rounded-xl border border-[#28332E] bg-[#121715] p-4">
            <div className="text-sm font-semibold text-white">Import images to assign to beats</div>
            <p className="text-xs text-[#9BA8A1]">
              Supports PNG (with transparency), JPG, JPEG, or instant White &amp; Green plates.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onAddWhiteAndGreenPlates}
                className="min-h-[44px] rounded-lg bg-[#16E575] px-4 text-xs font-bold text-[#0A0D0C]"
              >
                Create White &amp; Green
              </button>
              <button
                type="button"
                onClick={onPickImages}
                className="min-h-[44px] rounded-lg border border-[#28332E] bg-[#1A221F] px-4 text-xs font-semibold text-white"
              >
                Import Images
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Automatic Alternating Pattern System */}
            <div className="flex flex-col gap-2.5 rounded-xl border border-[#28332E] bg-[#121715] p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-white">Auto Pattern Sequence</span>
                {project.patternImageIds.length > 0 && (
                  <button
                    type="button"
                    onClick={onClearPattern}
                    className="text-xs text-[#9BA8A1] hover:text-white"
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Pattern sequence display */}
              <div className="flex items-center gap-1.5 overflow-x-auto rounded-lg bg-[#0A0D0C] p-2">
                {project.patternImageIds.length === 0 ? (
                  <span className="text-xs text-[#69766F]">
                    Tap images below to build a repeating sequence (e.g. White → Green)
                  </span>
                ) : (
                  project.patternImageIds.map((imgId, idx) => {
                    const asset = imageById.get(imgId);
                    if (!asset) return null;
                    return (
                      <React.Fragment key={`${imgId}_${idx}`}>
                        <button
                          type="button"
                          onClick={() => onRemovePatternStep(idx)}
                          className="flex items-center gap-1.5 rounded-md border border-[#16E575]/60 bg-[#1A221F] px-2 py-1 text-xs text-white shrink-0"
                        >
                          <img
                            src={asset.objectUrl}
                            alt={asset.name}
                            className="h-5 w-5 rounded object-cover"
                          />
                          <span className="max-w-[72px] truncate">
                            {asset.name.replace(/\.[^.]+$/, '')}
                          </span>
                          <X className="h-3 w-3 text-[#9BA8A1]" />
                        </button>
                        {idx < project.patternImageIds.length - 1 && (
                          <span className="text-xs font-bold text-[#16E575]">→</span>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </div>

              {/* Tap image to append to sequence */}
              <div className="flex gap-2 overflow-x-auto pb-1">
                {project.images.map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => onAppendPatternImage(asset.id)}
                    className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[#28332E] bg-[#1A221F] px-2.5 py-1 text-xs text-white hover:border-[#16E575] shrink-0"
                  >
                    <img
                      src={asset.objectUrl}
                      alt={asset.name}
                      className="h-6 w-6 rounded object-cover"
                    />
                    <span>+ {asset.name.replace(/\.[^.]+$/, '')}</span>
                  </button>
                ))}
              </div>

              <DurationSelector
                mode={project.patternDurationMode}
                customMs={project.patternCustomDurationMs}
                onChange={onPatternDurationChange}
              />

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={project.beats.length === 0 || project.patternImageIds.length === 0}
                  onClick={onApplyPatternToAll}
                  className="min-h-[44px] flex-1 rounded-lg bg-[#16E575] px-4 text-xs font-bold text-[#0A0D0C] hover:bg-[#1de97b] disabled:opacity-40"
                >
                  Apply Pattern to All Beats
                </button>
                <button
                  type="button"
                  disabled={!project.beats.some((b) => b.assignedImageId)}
                  onClick={onClearAllAssignments}
                  className="min-h-[44px] rounded-lg border border-[#28332E] bg-[#1A221F] px-3 text-xs font-semibold text-[#9BA8A1] hover:text-white disabled:opacity-40"
                >
                  Unassign
                </button>
              </div>
            </div>

            {/* Individual Selected Beat Assignment */}
            {selectedBeat && (
              <div className="flex flex-col gap-2 rounded-xl border border-[#28332E] bg-[#121715] p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-white">
                    Selected Beat ({formatTimecode(selectedBeat.timestampMs)})
                  </span>
                  {selectedBeat.assignedImageId && (
                    <button
                      type="button"
                      onClick={() => onAssignImageToSelected(null)}
                      className="font-semibold text-[#FF5252]"
                    >
                      Remove Image
                    </button>
                  )}
                </div>

                <div className="flex gap-2 overflow-x-auto pb-1">
                  {project.images.map((asset) => {
                    const assigned = selectedBeat.assignedImageId === asset.id;
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => onAssignImageToSelected(asset.id)}
                        className={`flex min-h-[38px] items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs shrink-0 ${
                          assigned
                            ? 'border-[#16E575] bg-[#132E20] font-bold text-[#16E575]'
                            : 'border-[#28332E] bg-[#1A221F] text-white'
                        }`}
                      >
                        <img
                          src={asset.objectUrl}
                          alt={asset.name}
                          className="h-6 w-6 rounded object-cover"
                        />
                        <span>{asset.name.replace(/\.[^.]+$/, '')}</span>
                      </button>
                    );
                  })}
                </div>

                <DurationSelector
                  mode={selectedBeat.durationMode}
                  customMs={selectedBeat.customDurationMs}
                  onChange={onSelectedDurationChange}
                />
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // EXPORT TAB
  return (
    <div className="flex flex-col gap-3 p-3 overflow-y-auto h-full">
      {/* Option A: MP4 Video */}
      <div className="flex flex-col gap-2.5 rounded-xl border border-[#28332E] bg-[#121715] p-3">
        <div className="text-sm font-semibold text-white">Option A · Export MP4 Video</div>
        <div className="grid grid-cols-7 gap-1.5">
          {(['720p', '1080p'] as ExportResolution[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onSelectResolution(r)}
              className={`col-span-1 min-h-[36px] rounded-md border text-[11px] font-semibold ${
                exportResolution === r
                  ? 'border-[#16E575] bg-[#132E20] text-[#16E575]'
                  : 'border-[#28332E] bg-[#1A221F] text-[#9BA8A1]'
              }`}
            >
              {r}
            </button>
          ))}
          {([30, 60] as ExportFps[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onSelectFps(f)}
              className={`col-span-1 min-h-[36px] rounded-md border text-[11px] font-semibold ${
                exportFps === f
                  ? 'border-[#16E575] bg-[#132E20] text-[#16E575]'
                  : 'border-[#28332E] bg-[#1A221F] text-[#9BA8A1]'
              }`}
            >
              {f}fps
            </button>
          ))}
          {(['9:16', '16:9', '1:1'] as AspectRatioPreset[]).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => onSelectAspectRatio(a)}
              className={`col-span-1 min-h-[36px] rounded-md border text-[11px] font-semibold ${
                project.aspectRatio === a
                  ? 'border-[#16E575] bg-[#132E20] text-[#16E575]'
                  : 'border-[#28332E] bg-[#1A221F] text-[#9BA8A1]'
              }`}
            >
              {a}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={!project.audioBlob}
          onClick={onExportMp4}
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-[#16E575] px-4 text-xs font-bold text-[#0A0D0C] hover:bg-[#1de97b] disabled:opacity-40"
        >
          <Film className="h-4 w-4" />
          <span>Render MP4 Video with Audio</span>
        </button>
      </div>

      {/* Option B: Alight Motion Project XML + Media ZIP */}
      <div className="flex flex-col gap-2 rounded-xl border border-[#28332E] bg-[#121715] p-3">
        <div className="text-sm font-semibold text-white">
          Option B · Alight Motion Project XML
        </div>
        <p className="text-[11px] leading-relaxed text-[#9BA8A1]">
          Generates Alight Motion XML (&lt;scene&gt;, &lt;bookmark t=&quot;ms&quot; /&gt;,
          &lt;audio&gt;, &lt;shape fillType=&quot;media&quot;&gt;) preserving all beat timestamps
          and image timing. Use Bundle ZIP to include all images &amp; audio alongside the XML.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={project.beats.length === 0}
            onClick={onExportXml}
            className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-white px-3 text-xs font-bold text-[#0A0D0C] hover:bg-neutral-200 disabled:opacity-40 whitespace-nowrap"
          >
            <FileCode2 className="h-4 w-4" />
            <span>Export XML</span>
          </button>
          <button
            type="button"
            disabled={project.beats.length === 0}
            onClick={onExportBundleZip}
            className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-[#16E575] bg-[#132E20] px-3 text-xs font-bold text-[#16E575] disabled:opacity-40 whitespace-nowrap"
          >
            <FolderArchive className="h-4 w-4" />
            <span>XML + Media ZIP</span>
          </button>
        </div>
      </div>

      {/* Option C: Beat Timestamps CSV & JSON */}
      <div className="flex flex-col gap-2 rounded-xl border border-[#28332E] bg-[#121715] p-3">
        <div className="text-sm font-semibold text-white">
          Option C · Beat Timestamps ({project.beats.length})
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={project.beats.length === 0}
            onClick={onExportCsv}
            className="flex min-h-[42px] items-center justify-center gap-1.5 rounded-lg border border-[#28332E] bg-[#1A221F] text-xs font-semibold text-white hover:border-[#16E575] disabled:opacity-40"
          >
            <FileSpreadsheet className="h-4 w-4" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            disabled={project.beats.length === 0}
            onClick={onExportJson}
            className="flex min-h-[42px] items-center justify-center gap-1.5 rounded-lg border border-[#28332E] bg-[#1A221F] text-xs font-semibold text-white hover:border-[#16E575] disabled:opacity-40"
          >
            <Download className="h-4 w-4" />
            <span>Export JSON</span>
          </button>
        </div>
      </div>
    </div>
  );
};

const DurationSelector: React.FC<{
  mode: DurationMode;
  customMs: number;
  onChange: (mode: DurationMode, customMs?: number) => void;
}> = ({ mode, customMs, onChange }) => {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-3 gap-1.5">
        {(['ONE_BEAT', 'TWO_BEATS', 'CUSTOM_MS'] as DurationMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m, customMs)}
            className={`min-h-[36px] rounded-md border text-xs font-semibold ${
              mode === m
                ? 'border-[#16E575] bg-[#132E20] text-[#16E575]'
                : 'border-[#28332E] bg-[#1A221F] text-[#9BA8A1]'
            }`}
          >
            {m === 'ONE_BEAT' ? '1 Beat' : m === 'TWO_BEATS' ? '2 Beats' : `${customMs}ms`}
          </button>
        ))}
      </div>
      {mode === 'CUSTOM_MS' && (
        <div className="grid grid-cols-5 gap-1.5">
          {[150, 250, 350, 500, 750].map((ms) => (
            <button
              key={ms}
              type="button"
              onClick={() => onChange('CUSTOM_MS', ms)}
              className={`min-h-[32px] rounded border text-[11px] font-mono-tnum ${
                customMs === ms
                  ? 'border-[#16E575] bg-[#132E20] text-[#16E575] font-bold'
                  : 'border-[#28332E] bg-[#0A0D0C] text-[#9BA8A1]'
              }`}
            >
              {ms}ms
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
