import type { FeatureFrame, SongAnalysis } from '../types';

/** Sample-and-hold: beats belong to a fixed analysis interval, never wall-clock state. */
export function featuresAt(analysis: SongAnalysis, time: number): FeatureFrame {
  const clamped = Number.isNaN(time) ? 0 : Math.max(0, Math.min(analysis.duration, time));
  const frames = analysis.frames;
  if (!frames.length) return { ...analysis.profile, time: clamped, beat: false };
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (frames[middle].time <= clamped) low = middle;
    else high = middle - 1;
  }
  return { ...frames[low], time: clamped, beat: clamped < analysis.duration && frames[low].beat };
}

export class AudioFeatureTimeline {
  static featuresAt = featuresAt;
  private readonly analysis: SongAnalysis;

  constructor(analysis: SongAnalysis) {
    this.analysis = analysis;
  }

  featuresAt(time: number): FeatureFrame {
    return featuresAt(this.analysis, time);
  }
}
