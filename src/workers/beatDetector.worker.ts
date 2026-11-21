import type { AudioEnvelopeFrame, BeatMarker, BeatType } from '../types/beatsync';

class BiquadBandpass {
  private b0: number;
  private b1 = 0;
  private b2: number;
  private a1: number;
  private a2: number;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(sampleRate: number, centerHz: number, q: number) {
    const clampedHz = Math.max(20, Math.min(sampleRate * 0.45, centerHz));
    const omega = (2 * Math.PI * clampedHz) / sampleRate;
    const alpha = Math.sin(omega) / (2 * q);
    const cosW = Math.cos(omega);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b2 = -alpha / a0;
    this.a1 = (-2 * cosW) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

export function extractEnvelopeAndPeaks(
  pcm: Float32Array,
  sampleRate: number,
  durationMs: number,
): { waveformPeaks: Float32Array; envelopeFrames: AudioEnvelopeFrame[] } {
  const WAVEFORM_BUCKETS = 3600;
  const HOP_MS = 10;
  const hopSamples = Math.max(1, Math.floor((sampleRate * HOP_MS) / 1000));
  const totalSamples = pcm.length;

  const waveformPeaks = new Float32Array(WAVEFORM_BUCKETS);
  let maxWaveformPeak = 0.001;

  const kickFilter = new BiquadBandpass(sampleRate, 85, 0.9);
  const snareFilter = new BiquadBandpass(sampleRate, 900, 0.75);
  const highFilter = new BiquadBandpass(sampleRate, 5200, 1.0);

  const envelopeFrames: AudioEnvelopeFrame[] = [];
  let hopCount = 0;
  let accKick = 0;
  let accSnare = 0;
  let accHigh = 0;
  let accBroad = 0;
  let prevKickLog = 0;
  let prevSnareLog = 0;
  let prevHighLog = 0;
  let prevBroadLog = 0;

  for (let i = 0; i < totalSamples; i++) {
    const s = pcm[i];
    const absS = Math.abs(s);
    const bucket = Math.min(WAVEFORM_BUCKETS - 1, Math.floor((i * WAVEFORM_BUCKETS) / Math.max(1, totalSamples)));
    if (absS > waveformPeaks[bucket]) {
      waveformPeaks[bucket] = absS;
      if (absS > maxWaveformPeak) maxWaveformPeak = absS;
    }

    const k = kickFilter.process(s);
    const sn = snareFilter.process(s);
    const h = highFilter.process(s);

    accKick += k * k;
    accSnare += sn * sn;
    accHigh += h * h;
    accBroad += s * s;
    hopCount++;

    if (hopCount >= hopSamples) {
      const n = hopCount;
      const kRms = Math.sqrt(accKick / n);
      const sRms = Math.sqrt(accSnare / n);
      const hRms = Math.sqrt(accHigh / n);
      const rms = Math.sqrt(accBroad / n);

      const kLog = Math.log(1 + 180 * kRms);
      const sLog = Math.log(1 + 180 * sRms);
      const hLog = Math.log(1 + 220 * hRms);
      const bLog = Math.log(1 + 120 * rms);

      const kFlux = Math.max(0, kLog - prevKickLog);
      const sFlux = Math.max(0, sLog - prevSnareLog);
      const hFlux = Math.max(0, hLog - prevHighLog);
      const bFlux = Math.max(0, bLog - prevBroadLog);

      prevKickLog = kLog;
      prevSnareLog = sLog;
      prevHighLog = hLog;
      prevBroadLog = bLog;

      const timeMs = Math.round(((i + 1) / Math.max(1, totalSamples)) * durationMs);
      envelopeFrames.push({
        timeMs,
        kickEnergy: kFlux * 0.7 + kRms * 0.3,
        snareMidEnergy: sFlux * 0.75 + sRms * 0.25,
        highEnergy: hFlux * 0.8 + hRms * 0.2,
        broadbandFlux: bFlux,
        rms,
      });

      hopCount = 0;
      accKick = 0;
      accSnare = 0;
      accHigh = 0;
      accBroad = 0;
    }
  }

  const inv = 1 / Math.max(0.01, maxWaveformPeak);
  for (let i = 0; i < WAVEFORM_BUCKETS; i++) {
    waveformPeaks[i] = Math.min(1, Math.max(0, waveformPeaks[i] * inv));
  }

  return { waveformPeaks, envelopeFrames };
}

function estimateWindowLag(
  onset: Float32Array,
  start: number,
  end: number,
  minLag: number,
  maxLag: number,
  hopMs: number,
): number {
  const len = end - start;
  if (len <= minLag * 2) {
    return Math.max(minLag, Math.min(maxLag, Math.round(60000 / 120 / hopMs)));
  }

  let bestLag = minLag;
  let bestScore = -1;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let acf = 0;
    const count = len - lag;
    for (let i = start; i < start + count; i++) {
      acf += onset[i] * onset[i + lag];
    }
    const doubleLag = lag * 2;
    if (doubleLag < len) {
      let acf2 = 0;
      for (let i = start; i < start + (len - doubleLag); i++) {
        acf2 += onset[i] * onset[i + doubleLag];
      }
      acf += 0.35 * acf2;
    }
    const bpm = 60000 / (lag * hopMs);
    const logRatio = Math.log(bpm / 120);
    const prior = Math.exp(-0.5 * (logRatio / 0.45) * (logRatio / 0.45));
    const score = (acf / Math.max(1, count)) * (0.65 + 0.35 * prior);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  return bestLag;
}

function classifyBeat(frames: AudioEnvelopeFrame[], idx: number, maxRms: number): BeatType {
  const f = frames[idx];
  const prevRms = idx >= 5 ? frames[idx - 5].rms : f.rms;
  if (f.rms > maxRms * 0.55 && f.rms > prevRms * 2.1) {
    return 'DROP';
  }
  if (f.kickEnergy >= f.snareMidEnergy * 1.15) {
    return 'KICK';
  }
  if (f.snareMidEnergy >= f.kickEnergy * 0.95) {
    return 'SNARE_CLAP';
  }
  return 'ACCENT';
}

export function detectStandardBeats(
  frames: AudioEnvelopeFrame[],
  sensitivity = 0.55,
): { beats: BeatMarker[]; estimatedBpm: number } {
  const n = frames.length;
  if (n < 20) return { beats: [], estimatedBpm: 0 };

  const hopMs =
    n >= 2
      ? Math.max(5, Math.min(25, (frames[n - 1].timeMs - frames[0].timeMs) / (n - 1)))
      : 10;

  const rawOnset = new Float32Array(n);
  let maxRms = 0.0001;
  for (let i = 0; i < n; i++) {
    const f = frames[i];
    if (f.rms > maxRms) maxRms = f.rms;
    rawOnset[i] =
      f.kickEnergy * 0.44 + f.snareMidEnergy * 0.38 + f.highEnergy * 0.1 + f.broadbandFlux * 0.08;
  }

  // Adaptive local median + MAD thresholding
  const halfWin = Math.max(6, Math.round(200 / hopMs));
  const adaptiveOnset = new Float32Array(n);
  const sensClamped = Math.max(0, Math.min(1, sensitivity));
  const kMad = 1.65 - sensClamped * 0.95;

  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - halfWin);
    const end = Math.min(n - 1, i + halfWin);
    const len = end - start + 1;
    const winSlice = Array.from(rawOnset.subarray(start, end + 1)).sort((a, b) => a - b);
    const median = winSlice[Math.floor(len / 2)];
    let absDev = 0;
    for (let j = start; j <= end; j++) {
      absDev += Math.abs(rawOnset[j] - median);
    }
    const mad = absDev / len;
    adaptiveOnset[i] = Math.max(0, rawOnset[i] - (median + kMad * mad));
  }

  // Smooth onset curve
  const smoothOnset = new Float32Array(n);
  let maxOnset = 0.0001;
  for (let i = 0; i < n; i++) {
    const prev = i > 0 ? adaptiveOnset[i - 1] : 0;
    const next = i < n - 1 ? adaptiveOnset[i + 1] : 0;
    const v = prev * 0.2 + adaptiveOnset[i] * 0.6 + next * 0.2;
    smoothOnset[i] = v;
    if (v > maxOnset) maxOnset = v;
  }
  for (let i = 0; i < n; i++) smoothOnset[i] /= maxOnset;

  // Sliding tempo tracker (handles slow, fast, & tempo changes)
  const minBpm = 58;
  const maxBpm = 192;
  const minLag = Math.max(5, Math.round(60000 / maxBpm / hopMs));
  const maxLag = Math.min(Math.floor(n / 3), Math.round(60000 / minBpm / hopMs));
  if (maxLag <= minLag) return { beats: [], estimatedBpm: 0 };

  const windowFrames = Math.max(300, Math.round(8000 / hopMs));
  const stepFrames = Math.max(100, Math.round(3000 / hopMs));
  const localPeriod = new Int32Array(n);
  const windowBpms: number[] = [];

  let winStart = 0;
  while (winStart < n) {
    const winEnd = Math.min(n, winStart + windowFrames);
    const bestLag = estimateWindowLag(smoothOnset, winStart, winEnd, minLag, maxLag, hopMs);
    windowBpms.push(60000 / (bestLag * hopMs));

    const fillStart = winStart === 0 ? 0 : winStart + Math.floor(stepFrames / 2);
    const fillEnd = Math.min(n, winStart + stepFrames + Math.floor(stepFrames / 2));
    for (let t = fillStart; t < fillEnd; t++) localPeriod[t] = bestLag;
    if (winEnd === n) break;
    winStart += stepFrames;
  }
  const fallbackLag = Math.max(minLag, Math.min(maxLag, Math.round(60000 / 120 / hopMs)));
  for (let t = 0; t < n; t++) {
    if (localPeriod[t] <= 0) localPeriod[t] = fallbackLag;
  }

  const sortedBpms = [...windowBpms].sort((a, b) => a - b);
  const globalBpm = sortedBpms.length ? sortedBpms[Math.floor(sortedBpms.length / 2)] : 120;

  // Ellis Dynamic Programming beat tracking
  const cumScore = new Float32Array(n);
  const backlink = new Int32Array(n).fill(-1);
  const alphaTightness = 140 + (1 - sensClamped) * 120;

  for (let t = 0; t < n; t++) {
    const period = localPeriod[t];
    const searchMin = Math.max(0, t - Math.round(period * 1.9));
    const searchMax = Math.max(-1, t - Math.round(period * 0.5));
    let bestPrevScore = 0;
    let bestPrevIdx = -1;

    for (let p = searchMin; p <= searchMax; p++) {
      const dt = t - p;
      const logRatio = Math.log(dt / period);
      const candidate = cumScore[p] - alphaTightness * logRatio * logRatio;
      if (bestPrevIdx === -1 || candidate > bestPrevScore) {
        bestPrevScore = candidate;
        bestPrevIdx = p;
      }
    }

    cumScore[t] = smoothOnset[t] + Math.max(0, bestPrevScore);
    backlink[t] = bestPrevIdx;
  }

  const tailStart = Math.max(0, n - maxLag * 2);
  let bestEnd = n - 1;
  for (let t = tailStart; t < n; t++) {
    if (cumScore[t] > cumScore[bestEnd]) bestEnd = t;
  }

  const rawIndices: number[] = [];
  let curr = bestEnd;
  while (curr >= 0) {
    rawIndices.push(curr);
    curr = backlink[curr];
  }
  rawIndices.reverse();

  // Snap beats to exact local transient peak + filter silence
  const snapRadius = Math.max(2, Math.round(30 / hopMs));
  const rmsSilenceGate = maxRms * 0.045;
  const minInterBeatMs = 175;
  const beats: BeatMarker[] = [];

  for (const dpIdx of rawIndices) {
    const sStart = Math.max(0, dpIdx - snapRadius);
    const sEnd = Math.min(n - 1, dpIdx + snapRadius);
    let peakIdx = dpIdx;
    let peakVal = rawOnset[dpIdx];
    for (let k = sStart; k <= sEnd; k++) {
      if (rawOnset[k] > peakVal) {
        peakVal = rawOnset[k];
        peakIdx = k;
      }
    }
    const frame = frames[peakIdx];
    if (frame.rms < rmsSilenceGate && smoothOnset[peakIdx] < 0.08) continue;
    if (beats.length > 0 && frame.timeMs - beats[beats.length - 1].timestampMs < minInterBeatMs) {
      continue;
    }

    beats.push({
      id: crypto.randomUUID(),
      timestampMs: frame.timeMs,
      type: classifyBeat(frames, peakIdx, maxRms),
      confidence: Math.min(1, Math.max(0.1, 0.55 + smoothOnset[peakIdx] * 0.45)),
      assignedImageId: null,
      durationMode: 'ONE_BEAT',
      customDurationMs: 350,
    });
  }

  // Catch extra prominent drops / syncopated hits at higher sensitivity
  if (sensClamped >= 0.48) {
    const extraThreshold = 0.68 - (sensClamped - 0.48) * 0.35;
    for (let i = 2; i < n - 2; i++) {
      const v = smoothOnset[i];
      if (
        v >= extraThreshold &&
        v > smoothOnset[i - 1] &&
        v >= smoothOnset[i + 1] &&
        frames[i].rms >= rmsSilenceGate * 2
      ) {
        const ts = frames[i].timeMs;
        if (!beats.some((b) => Math.abs(b.timestampMs - ts) < 160)) {
          beats.push({
            id: crypto.randomUUID(),
            timestampMs: ts,
            type: classifyBeat(frames, i, maxRms),
            confidence: Math.min(1, Math.max(0.4, v)),
            assignedImageId: null,
            durationMode: 'ONE_BEAT',
            customDurationMs: 350,
          });
        }
      }
    }
    beats.sort((a, b) => a.timestampMs - b.timestampMs);
  }

  return {
    beats,
    estimatedBpm: Math.round(globalBpm * 10) / 10,
  };
}

// Web Worker message handler
self.onmessage = (
  ev: MessageEvent<
    | { type: 'ANALYZE_PCM'; pcm: Float32Array; sampleRate: number; durationMs: number; sensitivity: number }
    | { type: 'DETECT_BEATS'; envelopeFrames: AudioEnvelopeFrame[]; sensitivity: number }
  >,
) => {
  const msg = ev.data;
  if (msg.type === 'ANALYZE_PCM') {
    const { waveformPeaks, envelopeFrames } = extractEnvelopeAndPeaks(
      msg.pcm,
      msg.sampleRate,
      msg.durationMs,
    );
    const { beats, estimatedBpm } = detectStandardBeats(envelopeFrames, msg.sensitivity);
    (self as unknown as Worker).postMessage(
      { type: 'ANALYZED', waveformPeaks, envelopeFrames, beats, estimatedBpm },
      [waveformPeaks.buffer],
    );
  } else if (msg.type === 'DETECT_BEATS') {
    const { beats, estimatedBpm } = detectStandardBeats(msg.envelopeFrames, msg.sensitivity);
    (self as unknown as Worker).postMessage({ type: 'DETECTED', beats, estimatedBpm });
  }
};
