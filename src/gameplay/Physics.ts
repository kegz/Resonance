import type { Level, PlayerState, Rect } from '../types';

export const PLAYER_WIDTH = 28;
export const PLAYER_HEIGHT = 40;
export const MOVE_SPEED = 340;
export const JUMP_SPEED = 650;
export const GRAVITY = 1800;
export const FIXED_STEP = 1 / 60;

export function overlaps(a: { x: number; y: number; width: number; height: number }, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function playerRect(player: PlayerState): Rect {
  return { id: -1, x: player.x, y: player.y, width: PLAYER_WIDTH, height: PLAYER_HEIGHT };
}

export function movePlayer(player: PlayerState, level: Level, direction: number, jump: boolean): void {
  if (jump && player.grounded) {
    player.vy = -JUMP_SPEED;
    player.grounded = false;
  }
  player.vx = direction * MOVE_SPEED;
  player.x += player.vx * FIXED_STEP;
  player.x = Math.max(0, Math.min(level.width - PLAYER_WIDTH, player.x));
  for (const platform of level.platforms) {
    if (!overlaps(playerRect(player), platform)) continue;
    if (player.vx > 0) player.x = platform.x - PLAYER_WIDTH;
    else if (player.vx < 0) player.x = platform.x + platform.width;
    player.vx = 0;
  }
  const previousBottom = player.y + PLAYER_HEIGHT;
  const previousTop = player.y;
  player.vy += GRAVITY * FIXED_STEP;
  player.y += player.vy * FIXED_STEP;
  player.grounded = false;
  for (const platform of level.platforms) {
    if (!overlaps(playerRect(player), platform)) continue;
    if (player.vy >= 0 && previousBottom <= platform.y + 0.01) {
      player.y = platform.y - PLAYER_HEIGHT;
      player.vy = 0;
      player.grounded = true;
    } else if (player.vy < 0 && previousTop >= platform.y + platform.height - 0.01) {
      player.y = platform.y + platform.height;
      player.vy = 0;
    }
  }
}
