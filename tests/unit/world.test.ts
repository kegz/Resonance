import { describe, expect, it, vi } from 'vitest';
import { generateLevel, GENERATOR_VERSION, MAX_GENERATION_ATTEMPTS } from '../../src/world/LevelGenerator';
import { validateLevel } from '../../src/world/LevelValidator';
import * as validator from '../../src/world/LevelValidator';
import { EnvironmentMapper, mapEnvironment } from '../../src/world/EnvironmentMapper';
import type { AudioFeatures, Level } from '../../src/types';

const profile: AudioFeatures = { bpm: 120, rms: 0.6, bass: 0.4, mids: 0.5, treble: 0.3, spectralCentroid: 0.18 };
const simpleLevel = (): Level => ({
  seed: 'simple', width: 1000, height: 500, start: { x: 50, y: 380 },
  goal: { id: 9, x: 900, y: 340, width: 60, height: 80 },
  platforms: [{ id: 0, x: 0, y: 420, width: 1000, height: 80 }],
  hazards: [], collectibles: [], environment: mapEnvironment(profile),
});

describe('world generation and validation', () => {
  it('generates identical, valid geometry over many fingerprints and difficulties', () => {
    for (let seed = 0; seed < 80; seed++) {
      const level = generateLevel(profile, `song-${seed}`, seed % 6, seed % 3);
      expect(level).toEqual(generateLevel(profile, `song-${seed}`, seed % 6, seed % 3));
      expect(level.seed).toContain(GENERATOR_VERSION);
      expect(validateLevel(level), `seed ${seed}`).toBe(true);
      expect(level.hazards.length).toBeGreaterThan(0);
      expect(level.collectibles.length).toBeGreaterThan(0);
    }
  });

  it('changes worlds for fingerprints, variants and difficulties', () => {
    const base = generateLevel(profile, 'song');
    expect(generateLevel(profile, 'other').platforms).not.toEqual(base.platforms);
    expect(generateLevel(profile, 'song', 1, 1).platforms).not.toEqual(base.platforms);
    expect(generateLevel(profile, 'song', 3).width).toBeGreaterThan(base.width);
  });

  it('validates candidates and deterministically derives a fresh seed for retries', () => {
    const validate = vi.spyOn(validator, 'validateLevel').mockReturnValueOnce(false);
    try {
      const level = generateLevel(profile, 'retry-song');
      expect(validate).toHaveBeenCalledTimes(2);
      expect(level.seed).toMatch(/:attempt-1$/);
      const first = validate.mock.calls[0][0];
      expect(first.seed).toMatch(/:attempt-0$/);
      expect(first.platforms).not.toEqual(level.platforms);
      expect(validateLevel(level)).toBe(true);
    } finally {
      validate.mockRestore();
    }
  });

  it('bounds invalid-candidate regeneration instead of looping forever', () => {
    const validate = vi.spyOn(validator, 'validateLevel').mockReturnValue(false);
    try {
      expect(() => generateLevel(profile, 'invalid')).toThrow('Could not generate a navigable level');
      expect(validate).toHaveBeenCalledTimes(MAX_GENERATION_ATTEMPTS);
    } finally {
      validate.mockRestore();
    }
  });

  it('accepts safe continuous ground and bounded jumpable hazards', () => {
    const level = simpleLevel();
    expect(validateLevel(level)).toBe(true);
    level.hazards.push({ id: 1, x: 480, y: 396, width: 35, height: 24 });
    expect(validateLevel(level)).toBe(true);
  });

  it('rejects unreachable goals, impossible gaps and impassable hazards', () => {
    const goal = simpleLevel();
    goal.goal.y = 50;
    expect(validateLevel(goal)).toBe(false);
    const gap = simpleLevel();
    gap.platforms = [
      { id: 0, x: 0, y: 420, width: 200, height: 80 },
      { id: 1, x: 700, y: 420, width: 300, height: 80 },
    ];
    expect(validateLevel(gap)).toBe(false);
    const hazard = simpleLevel();
    hazard.hazards.push({ id: 1, x: 400, y: 200, width: 100, height: 220 });
    expect(validateLevel(hazard)).toBe(false);
    const wall = simpleLevel();
    wall.platforms.push({ id: 1, x: 400, y: 100, width: 100, height: 320 });
    expect(validateLevel(wall)).toBe(false);
  });

  it('does not count an irreversible collectible branch as a completable route', () => {
    const level = simpleLevel();
    level.start = { x: 50, y: 160 };
    level.platforms.push({ id: 1, x: 0, y: 200, width: 250, height: 20 });
    level.collectibles = [{ id: 1, x: 100, y: 175 }, { id: 2, x: 500, y: 395 }];
    level.goal = { id: 9, x: 150, y: 120, width: 60, height: 80 };
    expect(validateLevel(level)).toBe(false);
  });

  it('checks mandatory collectible access even when the goal is reachable', () => {
    const level = simpleLevel();
    level.collectibles.push({ id: 1, x: 450, y: 40 });
    expect(validateLevel(level)).toBe(false);
    level.collectibles[0].y = 396;
    expect(validateLevel(level)).toBe(true);
    level.hazards.push({ id: 2, x: 430, y: 350, width: 60, height: 70 });
    expect(validateLevel(level)).toBe(false);
  });

  it('rejects unsafe starts, invalid geometry and duplicate collectible ids', () => {
    const level = simpleLevel();
    level.start.y = 100;
    expect(validateLevel(level)).toBe(false);
    level.start.y = 380;
    level.hazards.push({ id: 1, x: 50, y: 380, width: 30, height: 40 });
    expect(validateLevel(level)).toBe(false);
    level.hazards = [];
    level.platforms[0].width = Number.NaN;
    expect(validateLevel(level)).toBe(false);
    level.platforms[0].width = 1000;
    level.collectibles = [{ id: 1, x: 200, y: 400 }, { id: 1, x: 300, y: 400 }];
    expect(validateLevel(level)).toBe(false);
  });
});

describe('environment mapping', () => {
  it('maps all six audio features deterministically to bounded configuration', () => {
    expect(mapEnvironment(profile)).toEqual(mapEnvironment(profile));
    const quiet = mapEnvironment({ ...profile, rms: 0, bass: 0, treble: 0 });
    const loud = mapEnvironment({ ...profile, rms: 1, bass: 1, treble: 1, bpm: 200 });
    expect(loud.theme).toBe('volcanic');
    expect(loud.intensity).toBeGreaterThan(quiet.intensity);
    expect(loud.hazardRate).toBeGreaterThan(quiet.hazardRate);
    expect(loud.animationSpeed).toBeGreaterThan(quiet.animationSpeed);
    expect(loud.colorPalette.length).toBeGreaterThan(2);
    expect(mapEnvironment({ ...profile, treble: 0.9 }).theme).toBe('neon');
    expect(mapEnvironment({ ...profile, spectralCentroid: 0.7 }).theme).toBe('neon');
    expect(mapEnvironment({ ...profile, spectralCentroid: 0.1 }).theme).toBe('forest');
    expect(mapEnvironment({ ...profile, bpm: 165, rms: 0.9 }).theme).toBe('neon');
    expect(mapEnvironment({ ...profile, bpm: 165, rms: 0.1 }).theme).toBe('forest');
  });

  it('smooths intensity and uses theme hysteresis before switching', () => {
    const mapper = new EnvironmentMapper();
    const quiet = { ...profile, rms: 0, bass: 0, treble: 0, mids: 0 };
    const loud = { ...profile, rms: 1, bass: 1, treble: 1 };
    const first = mapper.update(quiet);
    const short = mapper.update(loud, 1 / 60);
    expect(short.theme).toBe(first.theme);
    expect(short.intensity).toBeGreaterThan(first.intensity);
    expect(short.intensity).toBeLessThan(mapEnvironment(loud).intensity);
    for (let tick = 0; tick < 180; tick++) mapper.update(loud);
    expect(mapper.update(loud).theme).toBe('volcanic');
    mapper.reset();
    expect(mapper.update(quiet).theme).toBe('dream');
  });
});
