import type { PendingAction } from "./tables/pendingAction";
import type { Player } from "./tables/player";
import type { PlayerSession } from "./tables/playerSession";
import { createInitialWorldState, type WorldState } from "./tables/worldState";

export type WorldEvent =
  | { type: "player_updated"; player: Player }
  | { type: "action_applied"; action: PendingAction }
  | { type: "tick_advanced"; tick: number };

export type WorldListener = (event: WorldEvent) => void;
export type PlayerListener = (player: Player) => void;

export interface WorldStore {
  worldState: WorldState;
  players: Map<string, Player>;
  playerSessions: Map<string, PlayerSession>;
  pendingActions: Map<string, PendingAction>;
  nextPlayerOrdinal: number;
  worldListeners: Set<WorldListener>;
  playerListeners: Map<string, Set<PlayerListener>>;
}

export function createWorld(seed?: number): WorldStore {
  return {
    worldState: createInitialWorldState(seed),
    players: new Map(),
    playerSessions: new Map(),
    pendingActions: new Map(),
    nextPlayerOrdinal: 1,
    worldListeners: new Set(),
    playerListeners: new Map()
  };
}

export function allocatePlayerId(world: WorldStore): string {
  while (true) {
    const candidate = `player-${world.nextPlayerOrdinal.toString().padStart(4, "0")}`;
    world.nextPlayerOrdinal += 1;
    if (!world.players.has(candidate)) {
      return candidate;
    }
  }
}

export function subscribeWorld(
  world: WorldStore,
  listener: WorldListener
): () => void {
  world.worldListeners.add(listener);
  return () => {
    world.worldListeners.delete(listener);
  };
}

export function subscribePlayer(
  world: WorldStore,
  playerId: string,
  listener: PlayerListener
): () => void {
  const existing = world.playerListeners.get(playerId) ?? new Set<PlayerListener>();
  existing.add(listener);
  world.playerListeners.set(playerId, existing);
  return () => {
    const listeners = world.playerListeners.get(playerId);
    if (!listeners) return;
    listeners.delete(listener);
    if (listeners.size === 0) {
      world.playerListeners.delete(playerId);
    }
  };
}

export function emitPlayerUpdated(world: WorldStore, player: Player): void {
  for (const listener of world.worldListeners) {
    listener({ type: "player_updated", player });
  }

  const playerListeners = world.playerListeners.get(player.playerId);
  if (!playerListeners) return;
  for (const listener of playerListeners) {
    listener(player);
  }
}

export function emitActionApplied(world: WorldStore, action: PendingAction): void {
  for (const listener of world.worldListeners) {
    listener({ type: "action_applied", action });
  }
}

export function emitTickAdvanced(world: WorldStore, tick: number): void {
  for (const listener of world.worldListeners) {
    listener({ type: "tick_advanced", tick });
  }
}
