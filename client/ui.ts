export interface MovePayload {
  dx: number;
  dy: number;
}

export interface ObstacleCell {
  x: number;
  y: number;
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

export function renderObstacleMap(
  playerX: number,
  playerY: number,
  obstacles: ObstacleCell[]
): string {
  const obstacleSet = new Set(obstacles.map((obstacle) => `${obstacle.x}:${obstacle.y}`));
  const rows: string[] = [];

  for (let y = playerY + MAP_RADIUS; y >= playerY - MAP_RADIUS; y -= 1) {
    let row = "";
    for (let x = playerX - MAP_RADIUS; x <= playerX + MAP_RADIUS; x += 1) {
      if (x === playerX && y === playerY) {
        row += "P";
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
