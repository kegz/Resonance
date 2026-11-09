import Meyda from 'meyda';
import type { AudioFeatures, FeatureFrame, SongAnalysis } from '../types';
import { ANALYSIS_FRAMES_PER_SECOND, MAX_ANALYSIS_FRAMES, MAX_AUDIO_DURATION_SECONDS } from './limits';

const FFT_SIZE = 2048;
const FALLBACK_BPM = 120;
const unit = (value: number): number => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

function estimateBpm(onsets: number[]): number {
  const strongest = Math.max(...onsets);
  if (strongest < 0.008) return FALLBACK_BPM;
  const significant = onsets.map((onset) => onset >= strongest * 0.2 ? onset : 0);
  if (significant.filter((onset) => onset > 0).length < 3) return FALLBACK_BPM;
  let bestLag = 0;
  let bestScore = 0;
  for (let lag = 7; lag <= 20; lag++) {
    let score = 0;
    for (let i = lag; i < significant.length; i++) score += significant[i] * significant[i - lag];
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  return bestLag ? Math.round(60 * ANALYSIS_FRAMES_PER_SECOND / bestLag) : FALLBACK_BPM;
}

/**
 * Bounded, offline Meyda FFT extraction. Only one mono window is allocated,
 * regardless of recording length; yielding every 32 frames keeps input responsive.
 */
export async function analyzeAudio(
  buffer: AudioBuffer,
  fingerprint: string,
  signal?: AbortSignal,
): Promise<SongAnalysis> {
  if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 ||
      buffer.duration > MAX_AUDIO_DURATION_SECONDS || !Number.isFinite(buffer.sampleRate) || buffer.sampleRate <= 0 ||
      !Number.isInteger(buffer.numberOfChannels) || buffer.numberOfChannels < 1 ||
      !Number.isInteger(buffer.length) || buffer.length < 1) {
    throw new Error('Audio must contain between 0 and 600 seconds of valid samples.');
  }
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const window = new Float32Array(FFT_SIZE);
  const frames: FeatureFrame[] = [];
  const onsets: number[] = [];
  const count = Math.min(MAX_ANALYSIS_FRAMES, Math.ceil(buffer.duration * ANALYSIS_FRAMES_PER_SECOND));
  let previousRms = 0;
  let lastBeat = -1;
  let yieldedAt = performance.now();

  for (let index = 0; index < count; index++) {
    if (signal?.aborted) throw new DOMException('Audio analysis was cancelled.', 'AbortError');
    const time = index / ANALYSIS_FRAMES_PER_SECOND;
    const start = Math.floor(time * buffer.sampleRate);
    window.fill(0);
    for (let sample = 0; sample < FFT_SIZE && start + sample < buffer.length; sample++) {
      let sum = 0;
      for (const channel of channels) sum += channel[start + sample] || 0;
      window[sample] = Math.max(-1, Math.min(1, sum / channels.length));
    }

    // Meyda's API uses global settings: restore them before the next asynchronous yield.
    const previousSize = Meyda.bufferSize;
    const previousRate = Meyda.sampleRate;
    const previousWindow = Meyda.windowingFunction;
    let extracted: ReturnType<typeof Meyda.extract>;
    try {
      Meyda.bufferSize = FFT_SIZE;
      Meyda.sampleRate = buffer.sampleRate;
      Meyda.windowingFunction = 'hanning';
      extracted = Meyda.extract(['rms', 'amplitudeSpectrum', 'spectralCentroid'], window);
    } finally {
      Meyda.bufferSize = previousSize;
      Meyda.sampleRate = previousRate;
      Meyda.windowingFunction = previousWindow;
    }
    const spectrum = extracted?.amplitudeSpectrum;
    let bass = 0;
    let mids = 0;
    let treble = 0;
    if (spectrum) {
      for (let bin = 1; bin < spectrum.length; bin++) {
        const frequency = bin * buffer.sampleRate / FFT_SIZE;
        const energy = spectrum[bin] ** 2;
        if (frequency < 250) bass += energy;
        else if (frequency < 4000) mids += energy;
        else treble += energy;
      }
    }
    const total = bass + mids + treble;
    const rms = unit(extracted?.rms ?? 0);
    const onset = Math.max(0, rms - previousRms);
    const beat = rms > 0.015 && onset > Math.max(0.008, previousRms * 0.35) && time - lastBeat >= 0.25;
    if (beat) lastBeat = time;
    onsets.push(onset);
    previousRms = rms;
    frames.push({
      time, beat, bpm: FALLBACK_BPM, rms,
      bass: total > 1e-12 ? unit(bass / total) : 0,
      mids: total > 1e-12 ? unit(mids / total) : 0,
      treble: total > 1e-12 ? unit(treble / total) : 0,
      spectralCentroid: unit((extracted?.spectralCentroid ?? 0) / (FFT_SIZE / 2)),
    });
    if (index % 32 === 31 || performance.now() - yieldedAt >= 8) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      yieldedAt = performance.now();
    }
  }
  const bpm = estimateBpm(onsets);
  const profile: AudioFeatures = { bpm, rms: 0, bass: 0, mids: 0, treble: 0, spectralCentroid: 0 };
  for (const frame of frames) {
    frame.bpm = bpm;
    profile.rms += frame.rms / frames.length;
    profile.bass += frame.bass / frames.length;
    profile.mids += frame.mids / frames.length;
    profile.treble += frame.treble / frames.length;
    profile.spectralCentroid += frame.spectralCentroid / frames.length;
  }
  return { fingerprint, duration: buffer.duration, profile, frames };
}
