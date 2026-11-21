import JSZip from 'jszip';
import {
  BeatProject,
  ExportFps,
  ExportResolution,
  formatTimecode,
  getResolutionDimensions,
  resolveBeatImageWindow,
} from '../types/beatsync';

function escXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function csvEsc(str: string): string {
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function sanitizeBaseName(title: string): string {
  return title.trim().replace(/[^A-Za-z0-9._-]+/g, '_') || 'beatsync_project';
}

export function buildAlightMotionXml(
  project: BeatProject,
  resolution: ExportResolution = '1080p',
  fps: ExportFps = 60,
): string {
  const { width, height } = getResolutionDimensions(project.aspectRatio, resolution);
  const totalTimeMs = Math.max(1000, project.durationMs);
  const nowMs = Date.now();
  const sortedBeats = [...project.beats].sort((a, b) => a.timestampMs - b.timestampMs);
  const imageById = new Map(project.images.map((img) => [img.id, img]));
  const audioFileName = project.originalMediaName
    ? `${sanitizeBaseName(project.originalMediaName.replace(/\.[^.]+$/, ''))}.m4a`
    : 'audio_track.m4a';

  const lines: string[] = [
    `<?xml version='1.0' encoding='UTF-8' ?>`,
    `<!-- Created by BeatSync AI for Alight Motion | Exported: ${new Date(nowMs).toISOString()} -->`,
    `<scene title="${escXml(project.title)}" width="${width}" height="${height}" exportWidth="${width}" exportHeight="${height}" precompose="dynamicResolution" bgcolor="#ff000000" totalTime="${totalTimeMs}" fps="${fps}" modifiedTime="${nowMs}" amver="104233" ffver="106" am="https://alightmotion.com/5.0.107.104233" amplatform="android" retime="freeze" retimeAdaptFPS="false">`,
  ];

  if (project.audioBlob) {
    lines.push(
      `    <media uri="media/${escXml(audioFileName)}" filename="${escXml(audioFileName)}" title="${escXml(project.originalMediaName || audioFileName)}" type="${escXml(project.audioMimeType || 'audio/mp4')}" size="${project.audioBlob.size}" duration="${totalTimeMs}" />`,
    );
  }

  for (const img of project.images) {
    const mediaRel = `media/${sanitizeBaseName(img.name)}`;
    lines.push(
      `    <media uri="${escXml(mediaRel)}" filename="${escXml(img.name)}" title="${escXml(img.name)}" type="${escXml(img.mimeType || 'image/png')}" size="${img.blob.size}" orientation="0" infoUpdated="${nowMs}" width="${img.width}" height="${img.height}" />`,
    );
  }

  // Exact millisecond beat bookmarks
  for (const beat of sortedBeats) {
    lines.push(`    <bookmark t="${Math.round(beat.timestampMs)}" />`);
  }

  // Audio track layer
  if (project.audioBlob) {
    lines.push(
      `    <audio id="100001" label="${escXml(project.originalMediaName || 'BGM')}" startTime="0" endTime="${totalTimeMs}" inTime="0" outTime="${totalTimeMs}" src="media/${escXml(audioFileName)}" />`,
    );
  }

  // Image layers in exact chronological order & timing
  const cx = (width / 2).toFixed(6);
  const cy = (height / 2).toFixed(6);
  const sw = width.toFixed(6);
  const sh = height.toFixed(6);

  let layerId = 200001;
  sortedBeats.forEach((beat, idx) => {
    if (!beat.assignedImageId) return;
    const img = imageById.get(beat.assignedImageId);
    if (!img) return;
    const { startMs, endMs } = resolveBeatImageWindow(sortedBeats, idx, totalTimeMs);
    const mediaRel = `media/${sanitizeBaseName(img.name)}`;
    const layerLabel = `Beat ${idx + 1} - ${img.name}`;

    lines.push(
      `    <shape id="${layerId}" label="${escXml(layerLabel)}" startTime="${Math.round(startMs)}" endTime="${Math.round(endMs)}" fillType="media" fillImage="${escXml(mediaRel)}" mediaFillMode="fill" s=".rect">`,
    );
    lines.push(`        <transform>`);
    lines.push(`            <location value="${cx},${cy},0.000000" />`);
    lines.push(`        </transform>`);
    lines.push(`        <property name="size" type="vec2" value="${sw},${sh}" />`);
    lines.push(`    </shape>`);
    layerId++;
  });

  lines.push(`</scene>`);
  return lines.join('\n');
}

export function buildMarkersCsv(project: BeatProject): string {
  const sortedBeats = [...project.beats].sort((a, b) => a.timestampMs - b.timestampMs);
  const imageById = new Map(project.images.map((img) => [img.id, img]));
  const totalTimeMs = Math.max(1000, project.durationMs);

  const rows = [
    'index,timestamp_ms,timecode,beat_type,confidence,assigned_image,image_start_ms,image_end_ms,duration_ms',
  ];

  sortedBeats.forEach((beat, idx) => {
    const img = beat.assignedImageId ? imageById.get(beat.assignedImageId) : undefined;
    const { startMs, endMs } = resolveBeatImageWindow(sortedBeats, idx, totalTimeMs);
    rows.push(
      [
        String(idx + 1),
        String(Math.round(beat.timestampMs)),
        formatTimecode(beat.timestampMs),
        beat.type,
        beat.confidence.toFixed(3),
        csvEsc(img?.name || ''),
        img ? String(Math.round(startMs)) : '',
        img ? String(Math.round(endMs)) : '',
        img ? String(Math.round(endMs - startMs)) : '',
      ].join(','),
    );
  });

  return rows.join('\n');
}

export function buildMarkersJson(project: BeatProject): string {
  const sortedBeats = [...project.beats].sort((a, b) => a.timestampMs - b.timestampMs);
  const imageById = new Map(project.images.map((img) => [img.id, img]));
  const totalTimeMs = Math.max(1000, project.durationMs);

  const payload = {
    app: 'BeatSync AI',
    title: project.title,
    durationMs: totalTimeMs,
    estimatedBpm: project.estimatedBpm,
    aspectRatio: project.aspectRatio,
    beatCount: sortedBeats.length,
    markers: sortedBeats.map((beat, idx) => {
      const img = beat.assignedImageId ? imageById.get(beat.assignedImageId) : undefined;
      const { startMs, endMs } = resolveBeatImageWindow(sortedBeats, idx, totalTimeMs);
      return {
        index: idx + 1,
        timestampMs: Math.round(beat.timestampMs),
        timecode: formatTimecode(beat.timestampMs),
        type: beat.type,
        confidence: Number(beat.confidence.toFixed(3)),
        ...(img
          ? {
              assignedImage: img.name,
              imageStartMs: Math.round(startMs),
              imageEndMs: Math.round(endMs),
              imageDurationMs: Math.round(endMs - startMs),
            }
          : {}),
      };
    }),
  };

  return JSON.stringify(payload, null, 2);
}

export async function buildAlightMotionBundleZip(
  project: BeatProject,
  resolution: ExportResolution,
  fps: ExportFps,
): Promise<Blob> {
  const zip = new JSZip();
  zip.file('project.xml', buildAlightMotionXml(project, resolution, fps));
  zip.file('markers.csv', buildMarkersCsv(project));
  zip.file('markers.json', buildMarkersJson(project));
  zip.file(
    'README_ALIGHT_MOTION.txt',
    [
      'BeatSync AI -> Alight Motion Project Package',
      '===========================================',
      `Project: ${project.title}`,
      `Estimated BPM: ${project.estimatedBpm}`,
      `Total Beats: ${project.beats.length}`,
      '',
      'Files included:',
      '1. project.xml   -> Alight Motion XML with <bookmark> beat timestamps and <shape> image layers',
      '2. markers.csv   -> Exact beat timestamps in milliseconds & image durations',
      '3. markers.json  -> Structured beat timing JSON',
      '4. media/        -> Extracted audio track and all assigned PNG/JPG images',
    ].join('\n'),
  );

  const mediaFolder = zip.folder('media');
  if (mediaFolder) {
    if (project.audioBlob) {
      const audioFileName = project.originalMediaName
        ? `${sanitizeBaseName(project.originalMediaName.replace(/\.[^.]+$/, ''))}.m4a`
        : 'audio_track.m4a';
      mediaFolder.file(audioFileName, project.audioBlob);
    }
    const seen = new Set<string>();
    for (const img of project.images) {
      const safeName = sanitizeBaseName(img.name);
      if (!seen.has(safeName)) {
        seen.add(safeName);
        mediaFolder.file(safeName, img.blob);
      }
    }
  }

  return zip.generateAsync({ type: 'blob' });
}

export function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
