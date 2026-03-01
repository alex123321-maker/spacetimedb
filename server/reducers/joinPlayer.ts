import { fx } from "../../shared/fixed";
import {
  allocatePlayerId,
  emitPlayerUpdated,
  type WorldStore
} from "../world";
import { createPlayerSession, type PlayerSession } from "../tables/playerSession";
import type { Player } from "../tables/player";

export interface JoinPlayerInput {
  sessionId: string;
  playerId?: string;
}

export interface JoinPlayerResult {
  player: Player;
  session: PlayerSession;
}

export function joinPlayerReducer(
  world: WorldStore,
  input: JoinPlayerInput
): JoinPlayerResult {
  const existingSession = world.playerSessions.get(input.sessionId);
  if (existingSession) {
    const existingPlayer = world.players.get(existingSession.playerId);
    if (!existingPlayer) {
      throw new Error(`player not found for existing session: ${input.sessionId}`);
    }
    return { player: existingPlayer, session: existingSession };
  }

  const resolvedPlayerId = input.playerId ?? allocatePlayerId(world);
  const existingPlayer = world.players.get(resolvedPlayerId);

  const player: Player =
    existingPlayer ??
    ({
      playerId: resolvedPlayerId,
      posX: fx(0),
      posY: fx(0),
      lastProcessedTick: -1
    } satisfies Player);

  world.players.set(resolvedPlayerId, player);
  const session = createPlayerSession(input.sessionId, resolvedPlayerId);
  world.playerSessions.set(input.sessionId, session);
  emitPlayerUpdated(world, player);
  return { player, session };
}
