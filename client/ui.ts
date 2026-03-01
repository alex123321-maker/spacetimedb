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
}

const FIXED_SCALE = 1000n;
const MAP_RADIUS = 5;

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

export function renderWorldMap(
  playerX: number,
  playerY: number,
  obstacles: ObstacleCell[],
  markers: SpawnMarkerCell[],
  generators: GeneratorCell[]
): string {
  const obstacleSet = new Set(obstacles.map((obstacle) => `${obstacle.x}:${obstacle.y}`));
  const markerSet = new Set(markers.map((marker) => `${marker.x}:${marker.y}`));
  const generatorSet = new Set(generators.map((generator) => `${generator.x}:${generator.y}`));
  const rows: string[] = [];

  for (let y = playerY + MAP_RADIUS; y >= playerY - MAP_RADIUS; y -= 1) {
    let row = "";
    for (let x = playerX - MAP_RADIUS; x <= playerX + MAP_RADIUS; x += 1) {
      if (x === playerX && y === playerY) {
        row += "P";
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
    .sort((a, b) => {
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    })
    .map((generator) => {
      const expiresIn = generator.expireTick > now ? generator.expireTick - now : 0n;
      return `${generator.id} @(${generator.x},${generator.y}) expiresInTicks=${expiresIn.toString()}`;
    });

  return ["generators:", ...rows].join("\n");
}

export function renderSpawnMarkersList(markers: SpawnMarkerCell[]): string {
  if (markers.length === 0) {
    return "spawn markers: none";
  }

  const rows = markers
    .slice()
    .sort((a, b) => {
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    })
    .map((marker) => `${marker.id} @(${marker.x},${marker.y}) spawnTick=${marker.spawnTick.toString()}`);

  return ["spawn markers:", ...rows].join("\n");
}
