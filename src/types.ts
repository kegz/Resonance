export interface AudioFeatures {
  bpm: number;
  rms: number;
  bass: number;
  mids: number;
  treble: number;
  spectralCentroid: number;
}

export interface FeatureFrame extends AudioFeatures {
  time: number;
  beat: boolean;
}

export interface SongAnalysis {
  fingerprint: string;
  duration: number;
  profile: AudioFeatures;
  frames: FeatureFrame[];
}

export interface EnvironmentConfig {
  theme: 'neon' | 'forest' | 'volcanic' | 'dream';
  intensity: number;
  hazardRate: number;
  animationSpeed: number;
  colorPalette: string[];
}

export interface Rect {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Level {
  seed: string;
  width: number;
  height: number;
  start: { x: number; y: number };
  goal: Rect;
  platforms: Rect[];
  hazards: Rect[];
  collectibles: { id: number; x: number; y: number }[];
  environment: EnvironmentConfig;
}

export interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  health: number;
  grounded: boolean;
}

export interface GameSnapshot {
  tick: number;
  player: PlayerState;
  entities: { id: number; active: boolean; phase: number }[];
  collectibles: { id: number; collected: boolean }[];
  randomState: number;
  audioTime: number;
  damageCooldown: number;
  won: boolean;
}

export interface InputState {
  left: boolean;
  right: boolean;
  jump: boolean;
  interact: boolean;
  rewind: boolean;
}

export const EMPTY_INPUT: InputState = {
  left: false, right: false, jump: false, interact: false, rewind: false,
};
