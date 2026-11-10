import type { Level, PlayerState, Rect } from '../types';
import { movePlayer, overlaps, PLAYER_HEIGHT, PLAYER_WIDTH, playerRect } from '../gameplay/Physics';

interface Region {
  min: number;
  max: number;
  y: number;
}

function regions(level: Level): Region[] {
  return level.platforms.flatMap(platform => {
    let spans = [{ min: platform.x, max: platform.x + platform.width - PLAYER_WIDTH, y: platform.y }];
    for (const obstacle of [...level.hazards, ...level.platforms.filter(other => other !== platform)]) {
      if (obstacle.y >= platform.y || obstacle.y + obstacle.height <= platform.y - PLAYER_HEIGHT) continue;
      spans = spans.flatMap(span => {
        const left = obstacle.x - PLAYER_WIDTH - 0.1;
        const right = obstacle.x + obstacle.width + 0.1;
        if (right < span.min || left > span.max) return [span];
        return [
          { ...span, max: Math.min(span.max, left) },
          { ...span, min: Math.max(span.min, right) },
        ].filter(part => part.min <= part.max);
      });
    }
    return spans.filter(span => span.min <= span.max);
  });
}

function canJump(level: Level, from: Region, to: Region): boolean {
  const distance = Math.max(to.min - from.max, from.min - to.max, 0);
  if (distance > 260 || from.y - to.y > 112 || to.y - from.y > 240) return false;
  const center = (to.min + to.max) / 2;
  const starts = [
    from.min, from.max, from.min + 35, from.min + 75, from.max - 35, from.max - 75,
    center, center - 90, center + 90, center - 170, center + 170,
  ]
    .map(x => Math.max(from.min, Math.min(from.max, x)));
  for (const x of new Set(starts)) {
    const player: PlayerState = {
      x, y: from.y - PLAYER_HEIGHT, vx: 0, vy: 0, grounded: true, health: 3,
    };
    for (let tick = 0; tick < 80; tick++) {
      const direction = player.x < to.min ? 1 : player.x > to.max ? -1 : 0;
      movePlayer(player, level, direction, tick === 0);
      if (level.hazards.some(hazard => overlaps(playerRect(player), hazard))) break;
      if (player.y > level.height) break;
      if (player.grounded) {
        if (Math.abs(player.y + PLAYER_HEIGHT - to.y) < 0.1
          && player.x >= to.min - 0.1 && player.x <= to.max + 0.1) return true;
        break;
      }
    }
  }
  return false;
}

function reachableRect(region: Region, rect: Rect): boolean {
  return region.min < rect.x + rect.width && region.max + PLAYER_WIDTH > rect.x
    && region.y > rect.y && region.y - PLAYER_HEIGHT < rect.y + rect.height;
}

/** Conservatively proves a safe route using the same fixed-step physics as gameplay. */
export function validateLevel(level: Level): boolean {
  if (!Number.isFinite(level.width) || !Number.isFinite(level.height)
    || level.width < PLAYER_WIDTH || level.height < PLAYER_HEIGHT) return false;
  const validRect = (rect: Rect): boolean =>
    [rect.id, rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    && rect.width > 0 && rect.height > 0 && rect.x >= 0 && rect.y >= 0
    && rect.x + rect.width <= level.width && rect.y + rect.height <= level.height;
  if (![...level.platforms, ...level.hazards, level.goal].every(validRect)) return false;
  if (!Number.isFinite(level.start.x) || !Number.isFinite(level.start.y)
    || level.start.x < 0 || level.start.y < 0
    || level.start.x + PLAYER_WIDTH > level.width || level.start.y + PLAYER_HEIGHT > level.height) return false;
  if (new Set(level.platforms.map(item => item.id)).size !== level.platforms.length
    || new Set(level.hazards.map(item => item.id)).size !== level.hazards.length
    || new Set(level.collectibles.map(item => item.id)).size !== level.collectibles.length) return false;
  const start = { id: -1, ...level.start, width: PLAYER_WIDTH, height: PLAYER_HEIGHT };
  if ([...level.hazards, ...level.platforms].some(rect => overlaps(start, rect))) return false;
  const nodes = regions(level);
  const reached = new Set<number>();
  const queue: number[] = [];
  const starts: number[] = [];
  nodes.forEach((node, index) => {
    if (level.start.x >= node.min && level.start.x <= node.max
      && Math.abs(level.start.y + PLAYER_HEIGHT - node.y) < 0.1) {
      reached.add(index);
      queue.push(index);
      starts.push(index);
    }
  });
  const edges = new Map<number, number[]>();
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const source = queue[cursor];
    const from = nodes[queue[cursor]];
    const targets: number[] = [];
    nodes.forEach((to, index) => {
      if (index !== source && canJump(level, from, to)) {
        targets.push(index);
        if (!reached.has(index)) {
          reached.add(index);
          queue.push(index);
        }
      }
    });
    edges.set(source, targets);
  }
  // Keep the mutually reachable component: visiting one mandatory item must not
  // strand the player away from another item or the exit.
  const returnable = new Set(starts);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [source, targets] of edges) {
      if (!returnable.has(source) && targets.some(target => returnable.has(target))) {
        returnable.add(source);
        changed = true;
      }
    }
  }
  const accessible = [...reached].filter(index => returnable.has(index)).map(index => nodes[index]);
  return accessible.some(node => reachableRect(node, level.goal))
    && level.collectibles.every(item =>
      Number.isFinite(item.id) && Number.isFinite(item.x) && Number.isFinite(item.y)
      && item.x >= 0 && item.x <= level.width && item.y >= 0 && item.y <= level.height
      && accessible.some(node => reachableRect(node, {
        id: item.id, x: item.x - 12, y: item.y - 12, width: 24, height: 24,
      })));
}
