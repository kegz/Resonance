import type { AudioFeatures, EnvironmentConfig } from '../types';

const palettes: Record<EnvironmentConfig['theme'], string[]> = {
  neon: ['#071126', '#32f5ff', '#ed44fa', '#f9e75e'],
  forest: ['#071f24', '#53d98b', '#a8f0b0', '#f1d88b'],
  volcanic: ['#221022', '#ff6947', '#ffbb58', '#d65790'],
  dream: ['#171737', '#a9a2ff', '#f8a9e3', '#86e4ed'],
};

const unit = (value: number): number => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

export function mapEnvironment(features: AudioFeatures): EnvironmentConfig {
  const intensity = unit(features.rms * 0.55 + features.bass * 0.3 + features.treble * 0.15);
  const theme = intensity > 0.65 && features.bass > 0.55 ? 'volcanic'
    : features.spectralCentroid > 0.45 || features.treble > 0.65
      || (features.bpm >= 145 && intensity > 0.5) ? 'neon'
      : features.mids > 0.45 ? 'forest' : 'dream';
  return {
    theme, intensity,
    hazardRate: 0.2 + intensity * 0.55,
    animationSpeed: 0.7 + unit(features.bpm / 200) * 0.9,
    colorPalette: [...palettes[theme]],
  };
}

export class EnvironmentMapper {
  private current?: AudioFeatures;
  private theme?: EnvironmentConfig['theme'];
  private candidate?: EnvironmentConfig['theme'];
  private candidateSeconds = 0;

  update(features: AudioFeatures, deltaSeconds = 1 / 60): EnvironmentConfig {
    const dt = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(0.25, deltaSeconds)) : 0;
    const alpha = 1 - Math.exp(-dt * 4);
    if (!this.current) this.current = { ...features };
    else {
      for (const key of Object.keys(this.current) as (keyof AudioFeatures)[]) {
        const target = Number.isFinite(features[key]) ? features[key] : this.current[key];
        this.current[key] += (target - this.current[key]) * alpha;
      }
    }
    const result = mapEnvironment(this.current);
    if (!this.theme) this.theme = result.theme;
    if (result.theme !== this.theme) {
      if (this.candidate !== result.theme) this.candidateSeconds = 0;
      this.candidate = result.theme;
      this.candidateSeconds += dt;
      if (this.candidateSeconds >= 0.6) this.theme = result.theme;
    } else {
      this.candidate = undefined;
      this.candidateSeconds = 0;
    }
    return { ...result, theme: this.theme, colorPalette: [...palettes[this.theme]] };
  }

  reset(): void {
    this.current = undefined;
    this.theme = undefined;
    this.candidate = undefined;
    this.candidateSeconds = 0;
  }
}
