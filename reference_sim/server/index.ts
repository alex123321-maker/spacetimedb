import { startTickLoop, type TickLoopHandle } from "./jobs/tickLoop";
import {
  enqueueActionReducer,
  type EnqueueActionInput
} from "./reducers/enqueueAction";
import { joinPlayerReducer, type JoinPlayerInput } from "./reducers/joinPlayer";
import { tickReducer } from "./reducers/tick";
import type { ClientActionEnvelope, PendingAction } from "./tables/pendingAction";
import type { Player } from "./tables/player";
import { DEFAULT_SEED } from "./tables/worldState";
import {
  createWorld,
  subscribePlayer,
  subscribeWorld,
  type WorldListener,
  type WorldStore
} from "./world";

export type DispatchAction =
  | { type: "Tick" }
  | { type: "JoinPlayer"; input: JoinPlayerInput }
  | { type: "EnqueueAction"; input: EnqueueActionInput };

export interface GameServer {
  world: WorldStore;
  dispatch: (action: DispatchAction) => unknown;
  joinPlayer: (input: JoinPlayerInput) => Player;
  enqueueAction: (sessionId: string, action: ClientActionEnvelope) => PendingAction;
  tick: () => number;
  start: () => void;
  stop: () => void;
  subscribePlayer: (playerId: string, cb: (player: Player) => void) => () => void;
  subscribeWorld: (cb: WorldListener) => () => void;
}

export function createServer(seed = DEFAULT_SEED): GameServer {
  const world = createWorld(seed);
  let loop: TickLoopHandle | null = null;

  const dispatch = (action: DispatchAction): unknown => {
    switch (action.type) {
      case "Tick":
        return tickReducer(world);
      case "JoinPlayer":
        return joinPlayerReducer(world, action.input);
      case "EnqueueAction":
        return enqueueActionReducer(world, action.input);
      default: {
        const exhaustiveCheck: never = action;
        throw new Error(`unhandled dispatch action: ${String(exhaustiveCheck)}`);
      }
    }
  };

  return {
    world,
    dispatch,
    joinPlayer(input: JoinPlayerInput): Player {
      const result = dispatch({ type: "JoinPlayer", input }) as ReturnType<
        typeof joinPlayerReducer
      >;
      return result.player;
    },
    enqueueAction(sessionId: string, action: ClientActionEnvelope): PendingAction {
      return dispatch({
        type: "EnqueueAction",
        input: { sessionId, action }
      }) as PendingAction;
    },
    tick(): number {
      return dispatch({ type: "Tick" }) as number;
    },
    start(): void {
      if (loop) return;
      loop = startTickLoop((tickAction) => {
        dispatch(tickAction);
      });
    },
    stop(): void {
      if (!loop) return;
      loop.stop();
      loop = null;
    },
    subscribePlayer(playerId: string, cb: (player: Player) => void): () => void {
      return subscribePlayer(world, playerId, cb);
    },
    subscribeWorld(cb: WorldListener): () => void {
      return subscribeWorld(world, cb);
    }
  };
}
