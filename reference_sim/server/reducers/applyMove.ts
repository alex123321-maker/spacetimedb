import { add, fx } from "../../../shared/fixed";
import type { PendingAction } from "../tables/pendingAction";
import type { WorldStore } from "../world";
import { emitPlayerUpdated } from "../world";

interface MovePayload {
  dx: number;
  dy: number;
}

function isMovePayload(value: unknown): value is MovePayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return Number.isInteger(candidate.dx) && Number.isInteger(candidate.dy);
}

export function applyMoveReducer(
  world: WorldStore,
  action: PendingAction,
  currentTick: number
): void {
  if (!isMovePayload(action.payload)) {
    throw new Error(`invalid Move payload for action ${action.id}`);
  }

  const player = world.players.get(action.playerId);
  if (!player) {
    throw new Error(`player not found for move: ${action.playerId}`);
  }

  const { dx, dy } = action.payload;
  const speed = Math.abs(dx) + Math.abs(dy);
  if (speed > 1) {
    throw new Error("Move exceeds speed limit (1 cell per tick)");
  }

  player.posX = add(player.posX, fx(dx));
  player.posY = add(player.posY, fx(dy));
  player.lastProcessedTick = currentTick;

  world.players.set(player.playerId, player);
  emitPlayerUpdated(world, player);
}
