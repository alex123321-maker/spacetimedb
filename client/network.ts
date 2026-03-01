import { type Identity } from "spacetimedb";
import { DbConnection, tables } from "./module_bindings";
import type { MovePayload } from "./ui";

const HOST = (globalThis as { __STDB_HOST__?: string }).__STDB_HOST__ ??
  "ws://127.0.0.1:3000";
const DB_NAME = (globalThis as { __STDB_DB_NAME__?: string }).__STDB_DB_NAME__ ??
  "continuum-grid";

type ReducerMap = Record<string, (args?: unknown) => unknown>;
type PlainObject = Record<string, unknown>;

export interface PlayerSnapshot {
  playerId: string;
  posX: bigint;
  posY: bigint;
  lastProcessedTick: bigint;
}

export interface ObstacleCell {
  id: string;
  x: number;
  y: number;
}

export interface SpawnMarkerSnapshot {
  id: string;
  x: number;
  y: number;
  spawnTick: bigint;
}

export interface GeneratorSnapshot {
  id: string;
  x: number;
  y: number;
  spawnTick: bigint;
  expireTick: bigint;
  ownerPlayerId: string;
  state: string;
}

export interface MoveCommandEnvelope {
  type: "Move";
  tick: number;
  seq: number;
  payload: MovePayload;
}

function readField<T>(row: PlainObject, ...keys: string[]): T | undefined {
  for (const key of keys) {
    if (key in row) return row[key] as T;
  }
  return undefined;
}

export class SpacetimeClient {
  private conn: DbConnection | null = null;
  private playerId: string | null = null;
  private seq = 0;

  connect(onPlayer: (player: PlayerSnapshot) => void): DbConnection {
    if (this.conn) return this.conn;

    this.conn = DbConnection.builder()
      .withUri(HOST)
      .withDatabaseName(DB_NAME)
      .withToken(localStorage.getItem("auth_token") || undefined)
      .onConnect((conn: DbConnection, identity: Identity, token: string) => {
        localStorage.setItem("auth_token", token);
        this.playerId = identity.toHexString();

        this.callReducer(["joinPlayer", "join_player"]);

        conn
          .subscriptionBuilder()
          .onApplied(() => {
            const current = this.getOwnPlayer();
            if (current) onPlayer(current);
          })
          .subscribe([
            tables.player,
            tables.worldState,
            tables.obstacle,
            tables.spawnMarker,
            tables.generator
          ]);

        conn.db.player.onInsert(() => {
          const current = this.getOwnPlayer();
          if (current) onPlayer(current);
        });
        conn.db.player.onUpdate(() => {
          const current = this.getOwnPlayer();
          if (current) onPlayer(current);
        });
      })
      .onConnectError((_ctx, error: Error) => {
        console.error("SpacetimeDB connect error:", error);
      })
      .onDisconnect(() => {
        console.warn("Disconnected from SpacetimeDB");
      })
      .build();

    return this.conn;
  }

  sendMove(payload: MovePayload): MoveCommandEnvelope {
    if (!this.conn) {
      throw new Error("Not connected");
    }

    this.seq += 1;
    const currentTick = this.getCurrentTick();
    const message: MoveCommandEnvelope = {
      type: "Move",
      tick: currentTick + 1,
      seq: this.seq,
      payload
    };

    this.callReducer(["enqueueAction", "enqueue_action"], {
      actionType: message.type,
      tick: BigInt(message.tick),
      seq: BigInt(message.seq),
      payloadJson: JSON.stringify(message.payload)
    });
    return message;
  }

  getCurrentTick(): number {
    if (!this.conn) return 0;
    const world = Array.from(this.conn.db.worldState.iter())[0] as
      | PlainObject
      | undefined;
    if (!world) return 0;
    const tick = readField<bigint>(world, "currentTick", "current_tick") ?? 0n;
    return Number(tick);
  }

  private getOwnPlayer(): PlayerSnapshot | null {
    if (!this.conn || !this.playerId) return null;
    const rows = Array.from(this.conn.db.player.iter()) as PlainObject[];
    const row = rows.find((candidate) => {
      const id = readField<string>(candidate, "playerId", "player_id");
      return id === this.playerId;
    });
    if (!row) return null;

    return {
      playerId: readField<string>(row, "playerId", "player_id") ?? this.playerId,
      posX: readField<bigint>(row, "posX", "pos_x") ?? 0n,
      posY: readField<bigint>(row, "posY", "pos_y") ?? 0n,
      lastProcessedTick:
        readField<bigint>(row, "lastProcessedTick", "last_processed_tick") ?? 0n
    };
  }

  getObstacles(): ObstacleCell[] {
    if (!this.conn) return [];
    const rows = Array.from(this.conn.db.obstacle.iter()) as PlainObject[];
    const obstacles = rows.map((row) => ({
      id: readField<string>(row, "id") ?? "",
      x: readField<number>(row, "x") ?? 0,
      y: readField<number>(row, "y") ?? 0
    }));

    obstacles.sort((a, b) => {
      if (a.y !== b.y) return a.y - b.y;
      if (a.x !== b.x) return a.x - b.x;
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    });
    return obstacles;
  }

  getSpawnMarkers(): SpawnMarkerSnapshot[] {
    if (!this.conn) return [];
    const rows = Array.from(this.conn.db.spawnMarker.iter()) as PlainObject[];
    const markers = rows.map((row) => ({
      id: readField<string>(row, "id") ?? "",
      x: readField<number>(row, "x") ?? 0,
      y: readField<number>(row, "y") ?? 0,
      spawnTick: readField<bigint>(row, "spawnTick", "spawn_tick") ?? 0n
    }));

    markers.sort((a, b) => {
      if (a.spawnTick !== b.spawnTick) return a.spawnTick < b.spawnTick ? -1 : 1;
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    });
    return markers;
  }

  getGenerators(): GeneratorSnapshot[] {
    if (!this.conn) return [];
    const rows = Array.from(this.conn.db.generator.iter()) as PlainObject[];
    const generators = rows.map((row) => ({
      id: readField<string>(row, "id") ?? "",
      x: readField<number>(row, "x") ?? 0,
      y: readField<number>(row, "y") ?? 0,
      spawnTick: readField<bigint>(row, "spawnTick", "spawn_tick") ?? 0n,
      expireTick: readField<bigint>(row, "expireTick", "expire_tick") ?? 0n,
      ownerPlayerId:
        readField<string>(row, "ownerPlayerId", "owner_player_id") ?? "",
      state: readField<string>(row, "state") ?? "neutral"
    }));

    generators.sort((a, b) => {
      if (a.expireTick !== b.expireTick) return a.expireTick < b.expireTick ? -1 : 1;
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    });
    return generators;
  }

  private callReducer(names: string[], args?: PlainObject): void {
    if (!this.conn) {
      throw new Error("Not connected");
    }
    const reducers = this.conn.reducers as unknown as ReducerMap;
    for (const name of names) {
      const fn = reducers[name];
      if (typeof fn === "function") {
        if (args) fn(args);
        else fn();
        return;
      }
    }
    throw new Error(`Reducer not found. Tried: ${names.join(", ")}`);
  }
}
