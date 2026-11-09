import type { AudioFeatures, Level } from '../types';
import { SeededRandom } from '../core/SeededRandom';
import { mapEnvironment } from './EnvironmentMapper';
import { validateLevel } from './LevelValidator';

export const GENERATOR_VERSION = 'resonance-v1';
export const MAX_GENERATION_ATTEMPTS = 6;

export function generateLevel(
  profile: AudioFeatures, fingerprint: string, difficulty = 1, worldVariant = 0,
): Level {
  const difficultyValue = Number.isFinite(difficulty) ? Math.max(0, Math.min(5, difficulty)) : 1;
  const variant = Number.isFinite(worldVariant) ? Math.floor(worldVariant) : 0;
  const baseSeed = `${GENERATOR_VERSION}:${fingerprint}:${difficultyValue}:${variant}`;
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const level = buildCandidate(profile, difficultyValue, `${baseSeed}:attempt-${attempt}`);
    if (validateLevel(level)) return level;
  }
  throw new Error(`Could not generate a navigable level after ${MAX_GENERATION_ATTEMPTS} attempts`);
}

function buildCandidate(profile: AudioFeatures, difficulty: number, seed: string): Level {
  const random = new SeededRandom(seed);
  const sections = 5 + Math.floor(difficulty);
  const width = sections * 500 + 400;
  const height = 540;
  const floor = height - 80;
  const level: Level = {
    seed, width, height, start: { x: 70, y: floor - 40 },
    goal: { id: 9000, x: width - 125, y: floor - 80, width: 65, height: 80 },
    platforms: [{ id: 0, x: 0, y: floor, width, height: 80 }],
    hazards: [], collectibles: [], environment: mapEnvironment(profile),
  };
  for (let index = 0; index < sections; index++) {
    const x = 270 + index * 500 + Math.floor(random.range(0, 35));
    const rise = 65 + Math.floor(random.range(0, 20));
    level.platforms.push({ id: index + 1, x, y: floor - rise, width: 145, height: 22 });
    level.collectibles.push({ id: index, x: x + 72, y: floor - rise - 24 });
    level.hazards.push({
      id: 1000 + index, x: x + 245, y: floor - 24,
      width: 28 + Math.floor(random.range(0, 13)), height: 24,
    });
  }
  return level;
}
