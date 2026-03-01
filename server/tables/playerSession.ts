export interface PlayerSession {
  sessionId: string;
  playerId: string;
  lastSeq: number;
  actionBudget: number;
}

export const ACTION_BUDGET_PER_TICK = 5;

export function createPlayerSession(
  sessionId: string,
  playerId: string
): PlayerSession {
  return {
    sessionId,
    playerId,
    lastSeq: 0,
    actionBudget: ACTION_BUDGET_PER_TICK
  };
}
