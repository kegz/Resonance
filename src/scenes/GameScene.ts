import Phaser from 'phaser';
import type { AudioFeatures, GameSnapshot, Level } from '../types';
import { PLAYER_WIDTH, PLAYER_HEIGHT } from '../gameplay/Physics';

export class GameScene extends Phaser.Scene {
  private shapes!: Phaser.GameObjects.Graphics;
  private level?: Level;
  private snapshot?: GameSnapshot;
  private features?: AudioFeatures & { beat?: boolean };
  private intensity = 0.4;
  private reducedMotion = false;
  onFrame: (delta: number) => void = () => undefined;

  constructor() { super('game'); }

  create() {
    this.shapes = this.add.graphics();
    this.cameras.main.setBackgroundColor('#0b1020');
    this.draw();
  }

  present(level: Level, snapshot: GameSnapshot, features: AudioFeatures & { beat?: boolean }, intensity: number) {
    this.level = level;
    this.snapshot = snapshot;
    this.features = features;
    this.intensity = intensity;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  clearWorld() {
    this.level = undefined;
    this.snapshot = undefined;
    this.cameras.main?.setScroll(0, 0);
  }

  update(_time: number, delta: number) {
    this.onFrame(delta / 1000);
    this.draw();
  }

  private draw() {
    if (!this.shapes) return;
    const graphics = this.shapes.clear();
    const level = this.level;
    const state = this.snapshot;
    if (!level || !state) {
      graphics.lineStyle(1, 0x273652);
      for (let x = 0; x < 960; x += 48) graphics.lineBetween(x, 0, x, 540);
      for (let y = 0; y < 540; y += 48) graphics.lineBetween(0, y, 960, y);
      return;
    }
    const cameraX = Phaser.Math.Clamp(state.player.x - 320, 0, Math.max(0, level.width - 960));
    this.cameras.main.setScroll(cameraX, 0);
    const color = Phaser.Display.Color.HexStringToColor(level.environment.colorPalette[1]).color;
    const energy = this.features?.rms ?? 0;
    const pulse = this.reducedMotion ? 0 : (energy + (this.features?.beat ? 0.1 : 0)) * this.intensity;
    graphics.fillStyle(color, 0.06 + pulse * 0.1);
    graphics.fillRect(cameraX, 0, 960, 540);
    // Slow, low-contrast decoration never changes collision geometry.
    for (let i = 0; i < 22; i++) {
      const x = (i * 137 + 41) % level.width;
      const y = 40 + (i * 61) % 310;
      graphics.fillStyle(color, 0.15);
      graphics.fillCircle(x, y, 3 + pulse * (i % 5 + 2));
    }
    for (const platform of level.platforms) {
      graphics.fillStyle(0x263953);
      graphics.fillRoundedRect(platform.x, platform.y, platform.width, platform.height, 4);
      graphics.fillStyle(color, 0.8);
      graphics.fillRect(platform.x, platform.y, platform.width, 3);
    }
    for (const hazard of level.hazards) {
      const active = state.entities.find((entity) => entity.id === hazard.id)?.active ?? false;
      graphics.fillStyle(active ? 0xef827d : 0x675263, active ? 0.85 : 0.35);
      graphics.fillTriangle(hazard.x, hazard.y + hazard.height,
        hazard.x + hazard.width / 2, hazard.y,
        hazard.x + hazard.width, hazard.y + hazard.height);
    }
    for (const item of level.collectibles) {
      if (state.collectibles.find((entry) => entry.id === item.id)?.collected) continue;
      graphics.fillStyle(0xffdb87);
      graphics.fillCircle(item.x, item.y, 8);
      graphics.lineStyle(2, 0xffdb87, 0.3);
      graphics.strokeCircle(item.x, item.y, 13);
    }
    graphics.fillStyle(state.won ? 0xffdb87 : 0x88e0c3, 0.3);
    graphics.fillRect(level.goal.x, level.goal.y, level.goal.width, level.goal.height);
    graphics.lineStyle(2, 0x88e0c3);
    graphics.strokeRect(level.goal.x, level.goal.y, level.goal.width, level.goal.height);
    graphics.fillStyle(state.player.health <= 0 ? 0xef827d : 0xf1f6ff);
    graphics.fillRoundedRect(state.player.x, state.player.y, PLAYER_WIDTH, PLAYER_HEIGHT, 6);
    graphics.fillStyle(color);
    graphics.fillRect(state.player.x + (state.player.vx < 0 ? 3 : 15), state.player.y + 8, 5, 5);
  }
}
