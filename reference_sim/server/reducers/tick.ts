import { cmpBy, cmpId, cmpU32, stableSort } from "../../../shared/determinism";
import { ACTION_BUDGET_PER_TICK } from "../tables/playerSession";
import type { PendingAction } from "../tables/pendingAction";
import {
  emitActionApplied,
  emitTickAdvanced,
  type WorldStore
} from "../world";
import { applyMoveReducer } from "./applyMove";

const pendingActionComparator = cmpBy<PendingAction>(
  (a, b) => cmpU32(a.tick, b.tick),
  (a, b) => cmpId(a.playerId, b.playerId),
  (a, b) => cmpU32(a.seq, b.seq),
  (a, b) => cmpId(a.id, b.id)
);

export function tickReducer(world: WorldStore): number {
  const currentTick = world.worldState.currentTick;
  const due = Array.from(world.pendingActions.values()).filter(
    (action) => action.tick <= currentTick
  );
  const orderedDue = stableSort(due, pendingActionComparator);

  for (const action of orderedDue) {
    try {
      if (action.type === "Move") {
        applyMoveReducer(world, action, currentTick);
        emitActionApplied(world, action);
      }
    } finally {
      world.pendingActions.delete(action.id);
    }
  }

  for (const session of world.playerSessions.values()) {
    session.actionBudget = ACTION_BUDGET_PER_TICK;
    world.playerSessions.set(session.sessionId, session);
  }

  world.worldState.currentTick = currentTick + 1;
  emitTickAdvanced(world, world.worldState.currentTick);
  return world.worldState.currentTick;
}
