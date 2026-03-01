import { toFloat } from "../shared/fixed";

export interface MovePayload {
  dx: number;
  dy: number;
}

export interface ObstacleCell {
  x: number;
  y: number;
}

export interface SpawnMarkerCell {
  id: string;
  x: number;
  y: number;
  spawnTick: bigint;
}

export interface GeneratorCell {
  id: string;
  x: number;
  y: number;
  spawnTick: bigint;
  expireTick: bigint;
  ownerPlayerId: string;
  state: string;
}

export interface PlayerCell {
  id: string;
  x: number;
  y: number;
  isSelf: boolean;
  posX: bigint;
  posY: bigint;
  rootGeneratorId: string;
  rootMoveAvailableAtTick: bigint;
}

const FIXED_SCALE = 1000n;
const MAP_RADIUS = 10;

export function mapInputToMove(input: string): MovePayload | null {
  switch (input) {
    case "ArrowUp":
    case "w":
    case "W":
      return { dx: 0, dy: -1 };
    case "ArrowDown":
    case "s":
    case "S":
      return { dx: 0, dy: 1 };
    case "ArrowLeft":
    case "a":
    case "A":
      return { dx: -1, dy: 0 };
    case "ArrowRight":
    case "d":
    case "D":
      return { dx: 1, dy: 0 };
    default:
      return null;
  }
}

export function toCell(value: bigint): number {
  return Number(value / FIXED_SCALE);
}

export function toPlayerCell(
  playerId: string,
  posX: bigint,
  posY: bigint,
  rootGeneratorId: string,
  rootMoveAvailableAtTick: bigint,
  ownPlayerId: string | null
): PlayerCell {
  return {
    id: playerId,
    x: toCell(posX),
    y: toCell(posY),
    isSelf: ownPlayerId === playerId,
    posX,
    posY,
    rootGeneratorId,
    rootMoveAvailableAtTick
  };
}

export function renderWorldMap(
  centerX: number,
  centerY: number,
  obstacles: ObstacleCell[],
  markers: SpawnMarkerCell[],
  generators: GeneratorCell[],
  players: PlayerCell[]
): string {
  const obstacleSet = new Set(obstacles.map((obstacle) => `${obstacle.x}:${obstacle.y}`));
  const markerSet = new Set(markers.map((marker) => `${marker.x}:${marker.y}`));
  const generatorSet = new Set(generators.map((generator) => `${generator.x}:${generator.y}`));
  const playerMap = new Map(players.map((player) => [`${player.x}:${player.y}`, player]));
  const rows: string[] = [];

  for (let y = centerY + MAP_RADIUS; y >= centerY - MAP_RADIUS; y -= 1) {
    let row = "";
    for (let x = centerX - MAP_RADIUS; x <= centerX + MAP_RADIUS; x += 1) {
      const player = playerMap.get(`${x}:${y}`);
      if (player?.isSelf) {
        row += "P";
      } else if (player) {
        row += "p";
      } else if (generatorSet.has(`${x}:${y}`)) {
        row += "G";
      } else if (markerSet.has(`${x}:${y}`)) {
        row += "?";
      } else if (obstacleSet.has(`${x}:${y}`)) {
        row += "#";
      } else {
        row += ".";
      }
    }
    rows.push(row);
  }

  return rows.join("\n");
}

export function renderGeneratorsList(
  generators: GeneratorCell[],
  currentTick: number
): string {
  if (generators.length === 0) {
    return "generators: none";
  }

  const now = BigInt(currentTick);
  const rows = generators
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((generator) => {
      const expiresIn = generator.expireTick > now ? generator.expireTick - now : 0n;
      const owner = generator.ownerPlayerId || "none";
      return `${generator.id} @(${generator.x},${generator.y}) state=${generator.state} owner=${owner} expiresInTicks=${expiresIn.toString()}`;
    });

  return ["generators:", ...rows].join("\n");
}

export function renderSpawnMarkersList(markers: SpawnMarkerCell[]): string {
  if (markers.length === 0) {
    return "spawn markers: none";
  }

  const rows = markers
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((marker) => `${marker.id} @(${marker.x},${marker.y}) spawnTick=${marker.spawnTick.toString()}`);

  return ["spawn markers:", ...rows].join("\n");
}

export function renderPlayersList(players: PlayerCell[]): string {
  if (players.length === 0) {
    return "players: none";
  }

  const rows = players
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((player) => {
      const tag = player.isSelf ? " (you)" : "";
      const fxX = toFloat(Number(player.posX)).toFixed(3);
      const fxY = toFloat(Number(player.posY)).toFixed(3);
      const root = player.rootGeneratorId || "none";
      return `${player.id}${tag} cell=(${player.x},${player.y}) pos=(${fxX},${fxY}) root=${root} rootMoveAvailableAt=${player.rootMoveAvailableAtTick.toString()}`;
    });
  return ["players:", ...rows].join("\n");
}
