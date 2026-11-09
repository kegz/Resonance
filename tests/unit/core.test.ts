import { describe, expect, it } from 'vitest';
import { GameLoop } from '../../src/core/GameLoop';
import { SeededRandom } from '../../src/core/SeededRandom';
import { EMPTY_INPUT } from '../../src/types';
import type { AudioFeatures, InputState, Level } from '../../src/types';

const features: AudioFeatures = { bpm: 120, rms: 0.5, bass: 0.5, mids: 0.4, treble: 0.3, spectralCentroid: 0.18 };
const input = (overrides: Partial<InputState> = {}): InputState => ({ ...EMPTY_INPUT, ...overrides });
const makeLevel = (): Level => ({
  seed: 'test', width: 1400, height: 500, start: { x: 50, y: 380 },
  goal: { id: 9, x: 1250, y: 340, width: 60, height: 80 },
  platforms: [{ id: 0, x: 0, y: 420, width: 1400, height: 80 }],
  hazards: [], collectibles: [],
  environment: { theme: 'dream', intensity: 0.5, hazardRate: 0.4, animationSpeed: 1, colorPalette: [] },
});
const run = (game: GameLoop, ticks: number, controls = input()): void => {
  for (let tick = 0; tick < ticks; tick++) game.advance(1 / 60, controls, features);
};

describe('SeededRandom', () => {
  it('is deterministic for many seeds and restores the exact stream', () => {
    for (let seed = 0; seed < 100; seed++) {
      const a = new SeededRandom(`seed-${seed}`);
      const b = new SeededRandom(`seed-${seed}`);
      const stream = Array.from({ length: 20 }, () => a.next());
      expect(stream).toEqual(Array.from({ length: 20 }, () => b.next()));
      expect(stream.every(value => value >= 0 && value < 1)).toBe(true);
      const state = a.state;
      const next = a.next();
      a.state = state;
      expect(a.next()).toBe(next);
    }
    expect(new SeededRandom('a').next()).not.toBe(new SeededRandom('b').next());
  });
});

describe('GameLoop', () => {
  it('moves left/right, jumps, lands, and respects world boundaries', () => {
    const game = new GameLoop(makeLevel());
    run(game, 60, input({ right: true }));
    expect(game.state.player.x).toBeCloseTo(390);
    run(game, 60, input({ left: true }));
    expect(game.state.player.x).toBeCloseTo(50);
    game.advance(1 / 60, input({ jump: true }), features);
    expect(game.state.player.y).toBeLessThan(380);
    run(game, 60, input({ jump: true }));
    expect(game.state.player.y).toBe(380);
    expect(game.state.player.grounded).toBe(true);
    run(game, 120, input({ left: true }));
    expect(game.state.player.x).toBe(0);
    run(game, 300, input({ right: true }));
    expect(game.state.player.x).toBe(1372);
  });

  it('collides with and lands on raised platforms', () => {
    const level = makeLevel();
    level.platforms.push({ id: 1, x: 180, y: 340, width: 180, height: 20 });
    const game = new GameLoop(level);
    run(game, 12, input({ right: true }));
    game.advance(1 / 60, input({ right: true, jump: true }), features);
    run(game, 18, input({ right: true }));
    run(game, 30);
    expect(game.state.player.y).toBe(300);
    expect(game.state.player.grounded).toBe(true);
  });

  it('uses fixed steps independent of frame grouping and clamps long or invalid delays', () => {
    const a = new GameLoop(makeLevel());
    const b = new GameLoop(makeLevel());
    run(a, 60, input({ right: true }));
    for (let tick = 0; tick < 20; tick++) b.advance(0.05, input({ right: true }), features);
    expect(b.state).toEqual(a.state);
    b.advance(30, input(), features);
    expect(b.state.tick).toBe(75);
    b.advance(Number.NaN, input(), features);
    b.advance(-1, input(), features);
    expect(b.state.tick).toBe(75);
  });

  it('keeps hazard schedules deterministic and responds to live features', () => {
    const level = makeLevel();
    level.hazards = [{ id: 1000, x: 900, y: 396, width: 35, height: 24 }];
    const a = new GameLoop(level);
    const b = new GameLoop(level);
    run(a, 21);
    run(b, 21);
    expect(a.state.entities).toEqual(b.state.entities);
    b.advance(1 / 60, input(), { ...features, bpm: 200, bass: 1 });
    a.advance(1 / 60, input(), features);
    expect(a.state.entities[0].phase).not.toBe(b.state.entities[0].phase);
    expect(a.state.entities[0].phase).toBeGreaterThan(0);
  });

  it('samples feature timelines at each fixed tick regardless of rendering cadence', () => {
    const level = makeLevel();
    level.hazards = [{ id: 1000, x: 900, y: 396, width: 35, height: 24 }];
    const a = new GameLoop(level);
    const b = new GameLoop(level);
    const times: number[] = [];
    const timeline = (time: number): AudioFeatures => ({
      ...features, bpm: time < 0.4 ? 90 : 180, bass: time < 0.7 ? 0.2 : 0.9,
    });
    for (let frame = 0; frame < 60; frame++) a.advance(1 / 60, input(), timeline);
    for (let frame = 0; frame < 10; frame++) {
      b.advance(0.1, input(), time => {
        times.push(time);
        return timeline(time);
      });
    }
    expect(b.state).toEqual(a.state);
    expect(times).toHaveLength(60);
    expect(times[0]).toBe(1 / 60);
    expect(times[59]).toBe(1);
    expect(b.state.audioTime).toBe(b.state.tick / 60);
    b.rewind(0.5);
    b.advance(1 / 60, input(), time => {
      expect(time).toBe(31 / 60);
      return timeline(time);
    });
  });

  it('never advances paused and drops fractional clock debt on pause', () => {
    const game = new GameLoop(makeLevel());
    game.advance(1 / 120, input(), features);
    game.pause();
    const before = structuredClone(game.state);
    game.advance(100, input({ right: true }), features);
    expect(game.state).toEqual(before);
    game.resume();
    game.advance(1 / 120, input(), features);
    expect(game.state.tick).toBe(0);
    game.advance(1 / 120, input(), features);
    expect(game.state.tick).toBe(1);
  });

  it('rewinds every collectible, health, cooldown, hazard phase and PRNG state', () => {
    const level = makeLevel();
    level.collectibles = [{ id: 1, x: 180, y: 390 }];
    level.hazards = [{ id: 1000, x: 290, y: 390, width: 35, height: 30 }];
    const game = new GameLoop(level);
    run(game, 30);
    const before = structuredClone(game.state);
    run(game, 45, input({ right: true }));
    expect(game.state.collectibles[0].collected).toBe(true);
    expect(game.state.player.health).toBeLessThan(3);
    expect(game.rewind(0.75)).toEqual(before);
    expect(game.state.damageCooldown).toBe(0);
    run(game, 45, input({ right: true }));
    const replay = structuredClone(game.state);
    game.rewind(0.75);
    run(game, 45, input({ right: true }));
    expect(game.state).toEqual(replay);
  });

  it('clamps rewind at the start, keeps only five seconds and truncates future history', () => {
    const game = new GameLoop(makeLevel());
    const original = structuredClone(game.state);
    expect(game.rewind(5)).toEqual(original);
    run(game, 30, input({ right: true }));
    expect(game.rewind(5)).toEqual(original);
    run(game, 360);
    expect(game.availableRewindSeconds).toBeCloseTo(5);
    expect(game.rewind(5).tick).toBe(60);
    run(game, 120, input({ right: true }));
    const futureX = game.state.player.x;
    game.rewind(1);
    run(game, 60, input({ left: true }));
    expect(game.state.player.x).toBeLessThan(futureX);
    expect(game.rewind(0.5).player.x).toBeLessThan(futureX);
  });

  it('returns detached rewind snapshots and resets completely', () => {
    const game = new GameLoop(makeLevel());
    run(game, 60, input({ right: true }));
    const rewound = game.rewind(1);
    rewound.player.health = 0;
    expect(game.state.player.health).toBe(3);
    game.pause();
    game.reset();
    expect(game.state).toEqual(new GameLoop(makeLevel()).state);
    expect(game.isPaused).toBe(false);
  });

  it('can rewind a death without advancing a dead world', () => {
    const level = makeLevel();
    level.platforms = [{ id: 0, x: 0, y: 420, width: 170, height: 80 }];
    const game = new GameLoop(level);
    run(game, 90, input({ right: true }));
    expect(game.state.player.health).toBe(0);
    const deathTick = game.state.tick;
    run(game, 20);
    expect(game.state.tick).toBe(deathTick);
    game.advance(1 / 60, input({ rewind: true }), features);
    expect(game.state.player.health).toBe(3);
    expect(game.state.tick).toBe(0);
  });

  it('requires all collectibles and explicit interaction at the goal', () => {
    const level = makeLevel();
    level.goal.x = 50;
    level.collectibles = [{ id: 1, x: 500, y: 390 }];
    const game = new GameLoop(level);
    run(game, 1, input({ interact: true }));
    expect(game.state.won).toBe(false);
    game.state.collectibles[0].collected = true;
    run(game, 1);
    expect(game.state.won).toBe(false);
    run(game, 1, input({ interact: true }));
    expect(game.state.won).toBe(true);
    game.rewind(1);
    expect(game.state.won).toBe(false);
  });

  it('continues the audio clock and rewind history after winning without moving the player', () => {
    const level = makeLevel();
    level.goal.x = 50;
    const game = new GameLoop(level);
    run(game, 30);
    run(game, 1, input({ interact: true }));
    expect(game.state.won).toBe(true);
    const winner = structuredClone(game.state.player);
    run(game, 120, input({ right: true, jump: true }));
    expect(game.state.won).toBe(true);
    expect(game.state.tick).toBe(151);
    expect(game.state.audioTime).toBe(151 / 60);
    expect(game.state.player).toEqual(winner);
    expect(game.rewind(1).won).toBe(true);
    expect(game.rewind(2).won).toBe(false);
  });
});
