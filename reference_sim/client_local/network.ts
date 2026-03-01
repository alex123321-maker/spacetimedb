import type { GameServer } from "../server/index";
import type { MovePayload } from "../server/tables/pendingAction";
import type { Player } from "../server/tables/player";

let sessionOrdinal = 1;

export interface OutgoingAction {
  type: string;
  tick: number;
  seq: number;
  payload: unknown;
}

export class LocalRealtimeClient {
  private server: GameServer | null = null;
  private sessionId: string | null = null;
  private playerId: string | null = null;
  private seq = 0;

  connect(server: GameServer, requestedPlayerId?: string): string {
    if (this.server) {
      if (!this.playerId) {
        throw new Error("connected state invalid: playerId is null");
      }
      return this.playerId;
    }

    this.server = server;
    this.sessionId = `session-${sessionOrdinal}`;
    sessionOrdinal += 1;

    const player = this.server.joinPlayer({
      sessionId: this.sessionId,
      playerId: requestedPlayerId
    });
    this.playerId = player.playerId;
    return player.playerId;
  }

  sendAction(type: string, payload: unknown): OutgoingAction {
    if (!this.server || !this.sessionId) {
      throw new Error("client is not connected");
    }
    this.seq += 1;
    const tick = this.server.world.worldState.currentTick + 1;
    const message: OutgoingAction = {
      type,
      tick,
      seq: this.seq,
      payload
    };
    this.server.enqueueAction(this.sessionId, message);
    return message;
  }

  sendMove(payload: MovePayload): OutgoingAction {
    return this.sendAction("Move", payload);
  }

  subscribeToOwnPlayer(cb: (player: Player) => void): () => void {
    if (!this.server || !this.playerId) {
      throw new Error("client is not connected");
    }
    return this.server.subscribePlayer(this.playerId, cb);
  }
}
