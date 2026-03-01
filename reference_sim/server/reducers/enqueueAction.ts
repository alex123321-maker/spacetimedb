import type { ClientActionEnvelope, PendingAction } from "../tables/pendingAction";
import type { WorldStore } from "../world";

export interface EnqueueActionInput {
  sessionId: string;
  action: ClientActionEnvelope;
}

export function enqueueActionReducer(
  world: WorldStore,
  input: EnqueueActionInput
): PendingAction {
  const session = world.playerSessions.get(input.sessionId);
  if (!session) {
    throw new Error(`session not found: ${input.sessionId}`);
  }

  const { action } = input;
  if (!Number.isInteger(action.seq)) {
    throw new Error("action.seq must be integer");
  }
  if (!Number.isInteger(action.tick)) {
    throw new Error("action.tick must be integer");
  }
  if (action.seq <= session.lastSeq) {
    throw new Error("action.seq must be greater than lastSeq");
  }
  if (action.tick < world.worldState.currentTick) {
    throw new Error("action.tick must be >= currentTick");
  }
  if (session.actionBudget <= 0) {
    throw new Error("rate limit exceeded for current tick");
  }

  const id = `${session.playerId}:${action.seq}`;
  if (world.pendingActions.has(id)) {
    throw new Error(`pending action already exists: ${id}`);
  }

  const pendingAction: PendingAction = {
    id,
    tick: action.tick,
    playerId: session.playerId,
    seq: action.seq,
    type: action.type,
    payload: action.payload
  };

  world.pendingActions.set(id, pendingAction);
  session.lastSeq = action.seq;
  session.actionBudget -= 1;
  world.playerSessions.set(session.sessionId, session);
  return pendingAction;
}
