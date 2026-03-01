import type { Player } from "../module_bindings/types";

const FIXED_SCALE = 1000;

interface Track {
  prevX: number;
  prevY: number;
  nextX: number;
  nextY: number;
  prevTick: number;
  nextTick: number;
  lastSeenTick: number;
}

export class Interpolation {
  private readonly tracks = new Map<string, Track>();

  update(players: Player[], tileSizePx: number): void {
    const seen = new Set<string>();

    for (const player of players) {
      seen.add(player.playerId);
      const x = (Number(player.posX) / FIXED_SCALE) * tileSizePx;
      const y = (Number(player.posY) / FIXED_SCALE) * tileSizePx;
      const tick = Number(player.lastUpdatedTick);
      const existing = this.tracks.get(player.playerId);

      if (!existing) {
        this.tracks.set(player.playerId, {
          prevX: x,
          prevY: y,
          nextX: x,
          nextY: y,
          prevTick: tick,
          nextTick: tick,
          lastSeenTick: tick,
        });
        continue;
      }

      if (existing.nextTick !== tick || existing.nextX !== x || existing.nextY !== y) {
        existing.prevX = existing.nextX;
        existing.prevY = existing.nextY;
        existing.prevTick = existing.nextTick;
        existing.nextX = x;
        existing.nextY = y;
        existing.nextTick = tick;
      }
      existing.lastSeenTick = tick;
    }

    for (const playerId of this.tracks.keys()) {
      if (!seen.has(playerId)) {
        this.tracks.delete(playerId);
      }
    }
  }

  getInterpolatedPx(playerId: string, renderTick: number): { x: number; y: number } | null {
    const track = this.tracks.get(playerId);
    if (!track) return null;

    if (track.nextTick <= track.prevTick) {
      return { x: track.nextX, y: track.nextY };
    }

    const t = Math.max(
      0,
      Math.min(1, (renderTick - track.prevTick) / (track.nextTick - track.prevTick)),
    );
    return {
      x: track.prevX + (track.nextX - track.prevX) * t,
      y: track.prevY + (track.nextY - track.prevY) * t,
    };
  }
}
