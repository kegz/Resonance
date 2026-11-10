import type { AudioFeatures, GameSnapshot, InputState, Level } from '../types';
import { FIXED_STEP, movePlayer, overlaps, playerRect } from '../gameplay/Physics';
import { SeededRandom } from './SeededRandom';

const clone = (state: GameSnapshot): GameSnapshot => ({
  ...state,
  player: { ...state.player },
  entities: state.entities.map(entity => ({ ...entity })),
  collectibles: state.collectibles.map(item => ({ ...item })),
});

export class GameLoop {
  public state: GameSnapshot;
  private readonly random: SeededRandom;
  private readonly level: Level;
  private history: GameSnapshot[] = [];
  private accumulator = 0;
  private paused = false;
  private jumpHeld = false;
  private jumpQueued = false;
  private rewindHeld = false;

  constructor(level: Level) {
    this.level = level;
    this.random = new SeededRandom(level.seed);
    this.state = this.initialState();
    this.history = [clone(this.state)];
  }

  private initialState(): GameSnapshot {
    return {
      tick: 0,
      player: { ...this.level.start, vx: 0, vy: 0, health: 3, grounded: true },
      entities: this.level.hazards.map(hazard => ({ id: hazard.id, active: false, phase: 0 })),
      collectibles: this.level.collectibles.map(item => ({ id: item.id, collected: false })),
      randomState: this.random.state,
      audioTime: 0,
      damageCooldown: 0,
      won: false,
    };
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get availableRewindSeconds(): number {
    return (this.state.tick - this.history[0].tick) * FIXED_STEP;
  }

  pause(): void {
    this.paused = true;
    this.resetClock();
  }

  resume(): void {
    this.paused = false;
    this.resetClock();
  }

  resetClock(): void {
    this.accumulator = 0;
    this.jumpHeld = false;
    this.jumpQueued = false;
    this.rewindHeld = false;
  }

  reset(): void {
    this.random.state = new SeededRandom(this.level.seed).state;
    this.state = this.initialState();
    this.history = [clone(this.state)];
    this.paused = false;
    this.resetClock();
  }

  advance(
    deltaSeconds: number,
    input: InputState,
    features: AudioFeatures | ((audioTime: number) => AudioFeatures),
  ): void {
    if (this.paused) return;
    if (input.rewind && !this.rewindHeld) {
      this.rewind();
      this.rewindHeld = true;
      return;
    }
    this.rewindHeld = input.rewind;
    if (this.state.player.health <= 0) return;
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    this.jumpQueued ||= input.jump && !this.jumpHeld;
    this.jumpHeld = input.jump;
    this.accumulator += Math.min(deltaSeconds, 0.25);
    while (this.accumulator + 1e-10 >= FIXED_STEP) {
      this.accumulator -= FIXED_STEP;
      const tickFeatures = typeof features === 'function'
        ? features((this.state.tick + 1) / 60)
        : features;
      this.step(input, tickFeatures);
      this.jumpQueued = false;
      if (this.state.player.health <= 0) {
        this.accumulator = 0;
        break;
      }
    }
  }

  private step(input: InputState, features: AudioFeatures): void {
    const state = this.state;
    state.tick++;
    state.audioTime = state.tick / 60;
    if (state.won) {
      this.recordSnapshot();
      return;
    }
    state.damageCooldown = Math.max(0, state.damageCooldown - FIXED_STEP);
    movePlayer(state.player, this.level, Number(input.right) - Number(input.left), this.jumpQueued);
    const bpm = Number.isFinite(features.bpm) ? Math.max(40, Math.min(220, features.bpm)) : 120;
    const bass = Number.isFinite(features.bass) ? Math.max(0, Math.min(1, features.bass)) : 0;
    for (const entity of state.entities) {
      entity.phase = (entity.phase + FIXED_STEP * bpm / 120) % 1;
      const offset = (entity.id * 0.61803398875) % 1;
      entity.active = ((entity.phase + offset) % 1) < 0.35 + bass * 0.35;
    }
    this.random.next();
    state.randomState = this.random.state;
    for (const item of state.collectibles) {
      const position = this.level.collectibles.find(collectible => collectible.id === item.id)!;
      if (overlaps(playerRect(state.player), {
        id: item.id, x: position.x - 12, y: position.y - 12, width: 24, height: 24,
      })) item.collected = true;
    }
    const damaged = state.entities.some(entity => entity.active
      && overlaps(playerRect(state.player), this.level.hazards.find(hazard => hazard.id === entity.id)!));
    if (damaged && state.damageCooldown <= 0) {
      state.player.health = Math.max(0, state.player.health - 1);
      state.damageCooldown = 1;
    }
    if (state.player.y > this.level.height) state.player.health = 0;
    state.won = state.player.health > 0 && input.interact
      && state.collectibles.every(item => item.collected)
      && overlaps(playerRect(state.player), this.level.goal);
    this.recordSnapshot();
  }

  private recordSnapshot(): void {
    const state = this.state;
    const previous = this.history[this.history.length - 1];
    if (state.tick % 3 === 0 || state.player.health <= 0 || (state.won && !previous.won)) {
      this.history.push(clone(state));
    }
    this.history = this.history.filter(snapshot => snapshot.tick >= state.tick - 300);
  }

  rewind(seconds = 3): GameSnapshot {
    const duration = Number.isFinite(seconds) ? Math.max(0, Math.min(5, seconds)) : 3;
    if (duration === 0) return clone(this.state);
    const target = this.state.tick - duration / FIXED_STEP;
    const snapshot = [...this.history].reverse().find(item => item.tick <= target) ?? this.history[0];
    this.state = clone(snapshot);
    this.random.state = this.state.randomState;
    this.history = this.history.filter(item => item.tick <= this.state.tick);
    this.resetClock();
    return clone(this.state);
  }
}
