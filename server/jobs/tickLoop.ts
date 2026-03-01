import { TICK_INTERVAL_MS } from "../tables/worldState";

export type DispatchTick = (action: { type: "Tick" }) => void;

export interface TickLoopHandle {
  stop: () => void;
}

export function startTickLoop(
  dispatch: DispatchTick,
  intervalMs = TICK_INTERVAL_MS
): TickLoopHandle {
  const timer = setInterval(() => {
    dispatch({ type: "Tick" });
  }, intervalMs);

  return {
    stop: () => clearInterval(timer)
  };
}
