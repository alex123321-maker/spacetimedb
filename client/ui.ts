import type { MovePayload } from "../server/tables/pendingAction";

export function mapInputToMove(input: string): MovePayload | null {
  switch (input) {
    case "ArrowUp":
    case "w":
      return { dx: 0, dy: -1 };
    case "ArrowDown":
    case "s":
      return { dx: 0, dy: 1 };
    case "ArrowLeft":
    case "a":
      return { dx: -1, dy: 0 };
    case "ArrowRight":
    case "d":
      return { dx: 1, dy: 0 };
    default:
      return null;
  }
}
