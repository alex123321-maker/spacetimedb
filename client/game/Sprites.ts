import { Graphics } from "pixi.js";
import type { Generator, Line } from "../module_bindings/types";

export const COLORS = {
  background: 0x0b121c,
  grid: 0x1c2633,
  obstacle: 0x394a61,
  junk0: 0x7f8c8d,
  junk1: 0x9b59b6,
  junk2: 0xf39c12,
  junk3: 0x3498db,
  line: 0x8ecae6,
  lineHot: 0xe74c3c,
  lineCooldown: 0xf4a261,
  playerSelfFill: 0x2ecc71,
  playerSelfStroke: 0xd5f9de,
  playerOtherFill: 0xf1c40f,
  playerOtherStroke: 0xfff4cc,
  generatorNeutral: 0x95a5a6,
  generatorControlled: 0x27ae60,
  generatorIsolated: 0xe67e22,
  generatorConnected: 0x00b4d8,
  selection: 0xffffff,
} as const;

export function getJunkColor(kind: number): number {
  const normalized = Math.abs(kind) % 4;
  if (normalized === 0) return COLORS.junk0;
  if (normalized === 1) return COLORS.junk1;
  if (normalized === 2) return COLORS.junk2;
  return COLORS.junk3;
}

export function getGeneratorColor(generator: Generator): number {
  if (generator.state === "controlled" && generator.isConnected) {
    return COLORS.generatorConnected;
  }
  if (generator.state === "controlled") {
    return COLORS.generatorControlled;
  }
  if (generator.state === "isolated") {
    return COLORS.generatorIsolated;
  }
  return COLORS.generatorNeutral;
}

export function drawObstacleBlock(graphics: Graphics, tileSize: number): void {
  graphics.clear();
  graphics.rect(0, 0, tileSize, tileSize).fill({ color: COLORS.obstacle });
}

export function drawJunkBlock(graphics: Graphics, tileSize: number, kind: number): void {
  const pad = tileSize * 0.24;
  graphics.clear();
  graphics.rect(pad, pad, tileSize - pad * 2, tileSize - pad * 2).fill({
    color: getJunkColor(kind),
  });
}

export function drawGenerator(
  graphics: Graphics,
  tileSize: number,
  generator: Generator,
  selected: boolean,
): void {
  const center = tileSize * 0.5;
  const radius = tileSize * 0.34;
  graphics.clear();
  graphics.circle(center, center, radius).fill({ color: getGeneratorColor(generator) });
  graphics.circle(center, center, radius).stroke({
    color: selected ? COLORS.selection : 0x162230,
    width: selected ? Math.max(2, tileSize * 0.12) : Math.max(1, tileSize * 0.08),
  });
}

export function drawPlayer(graphics: Graphics, tileSize: number, isSelf: boolean): void {
  const center = tileSize * 0.5;
  const radius = tileSize * 0.24;
  graphics.clear();
  graphics.circle(center, center, radius).fill({
    color: isSelf ? COLORS.playerSelfFill : COLORS.playerOtherFill,
  });
  graphics.circle(center, center, radius).stroke({
    color: isSelf ? COLORS.playerSelfStroke : COLORS.playerOtherStroke,
    width: Math.max(1, tileSize * 0.08),
  });
}

export function drawLines(
  graphics: Graphics,
  lines: Line[],
  generatorsById: Map<string, Generator>,
  tileSize: number,
): void {
  graphics.clear();

  for (const line of lines) {
    const a = generatorsById.get(line.aGeneratorId);
    const b = generatorsById.get(line.bGeneratorId);
    if (!a || !b) continue;

    const color = line.overheated
      ? COLORS.lineHot
      : line.active
        ? COLORS.line
        : COLORS.lineCooldown;
    const width = line.overheated
      ? Math.max(3, tileSize * 0.22)
      : Math.max(2, tileSize * 0.18);
    const alpha = line.overheated ? 0.95 : line.active ? 0.92 : 0.45;
    const ax = (a.x + 0.5) * tileSize;
    const ay = (a.y + 0.5) * tileSize;
    const bx = (b.x + 0.5) * tileSize;
    const by = (b.y + 0.5) * tileSize;

    graphics.moveTo(ax, ay).lineTo(bx, by).stroke({ color, width, alpha });
  }
}
