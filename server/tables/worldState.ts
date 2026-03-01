export interface WorldState {
  id: "singleton";
  currentTick: number;
  tickRate: number;
  seed: number;
}

export const WORLD_STATE_ID: WorldState["id"] = "singleton";
export const TICK_RATE = 20;
export const TICK_INTERVAL_MS = 50;
export const DEFAULT_SEED = 12345;

export function createInitialWorldState(seed = DEFAULT_SEED): WorldState {
  return {
    id: WORLD_STATE_ID,
    currentTick: 0,
    tickRate: TICK_RATE,
    seed
  };
}
