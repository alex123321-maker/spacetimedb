import { type Identity } from "spacetimedb";
import { DbConnection, tables } from "../module_bindings";
import localSpacetimeConfig from "../../spacetime.local.json";
import type {
  CaptureAttempt,
  EventLog,
  Generator,
  Junk,
  Line,
  Obstacle,
  Player,
  RootNode,
  RootRelocation,
  SpawnMarker,
  WorldConfig,
  WorldState,
} from "../module_bindings/types";
import { CLIENT_SUBSCRIPTIONS } from "./Subscriptions";

const FALLBACK_HOST = "http://127.0.0.1:3000";
const FALLBACK_DB_NAME =
  typeof localSpacetimeConfig.database === "string" &&
  localSpacetimeConfig.database.length > 0
    ? localSpacetimeConfig.database
    : "continum-grids-3vxm5";

const HOST =
  import.meta.env.VITE_SPACETIME_HOST ??
  (globalThis as { __STDB_HOST__?: string }).__STDB_HOST__ ??
  FALLBACK_HOST;
const DB_NAME =
  import.meta.env.VITE_SPACETIME_DB ??
  (globalThis as { __STDB_DB_NAME__?: string }).__STDB_DB_NAME__ ??
  FALLBACK_DB_NAME;

const FIXED_SCALE = 1000;

type ReducerMap = Record<string, (args?: unknown) => Promise<void>>;
type Listener = () => void;

type VersionKey =
  | "worldState"
  | "worldConfig"
  | "player"
  | "obstacle"
  | "junk"
  | "generator"
  | "line"
  | "rootNode"
  | "rootRelocation"
  | "captureAttempt"
  | "eventLog";

export interface SnapshotVersions {
  worldState: number;
  worldConfig: number;
  player: number;
  obstacle: number;
  junk: number;
  generator: number;
  line: number;
  rootNode: number;
  rootRelocation: number;
  captureAttempt: number;
  eventLog: number;
}

export interface WorldSnapshot {
  myPlayerId: string | null;
  worldState: WorldState | null;
  worldConfig: WorldConfig | null;
  players: Player[];
  obstacles: Obstacle[];
  junk: Junk[];
  generators: Generator[];
  lines: Line[];
  rootNodes: RootNode[];
  rootRelocations: RootRelocation[];
  captureAttempts: CaptureAttempt[];
  eventLog: EventLog[];
  versions: SnapshotVersions;
}

interface WorldStore {
  worldState: WorldState | null;
  worldConfig: WorldConfig | null;
  players: Map<string, Player>;
  obstacles: Map<string, Obstacle>;
  junk: Map<string, Junk>;
  generators: Map<string, Generator>;
  lines: Map<string, Line>;
  rootNodes: Map<string, RootNode>;
  rootRelocations: Map<string, RootRelocation>;
  captureAttempts: Map<string, CaptureAttempt>;
  eventLog: Map<string, EventLog>;
}

function sortByStringId<T extends { id: string }>(rows: Iterable<T>): T[] {
  return Array.from(rows).sort((a, b) => a.id.localeCompare(b.id));
}

function sortByPlayerId<T extends { playerId: string }>(rows: Iterable<T>): T[] {
  return Array.from(rows).sort((a, b) => a.playerId.localeCompare(b.playerId));
}

export function fixedToCell(value: bigint): number {
  return Number(value) / FIXED_SCALE;
}

export class NetClient {
  private conn: DbConnection | null = null;
  private myPlayerId: string | null = null;
  private seq = 0;
  private connectPromise: Promise<void> | null = null;
  private hydrated = false;
  private listeners = new Set<Listener>();
  private notifyQueued = false;

  private readonly versions: SnapshotVersions = {
    worldState: 0,
    worldConfig: 0,
    player: 0,
    obstacle: 0,
    junk: 0,
    generator: 0,
    line: 0,
    rootNode: 0,
    rootRelocation: 0,
    captureAttempt: 0,
    eventLog: 0,
  };

  private readonly store: WorldStore = {
    worldState: null,
    worldConfig: null,
    players: new Map<string, Player>(),
    obstacles: new Map<string, Obstacle>(),
    junk: new Map<string, Junk>(),
    generators: new Map<string, Generator>(),
    lines: new Map<string, Line>(),
    rootNodes: new Map<string, RootNode>(),
    rootRelocations: new Map<string, RootRelocation>(),
    captureAttempts: new Map<string, CaptureAttempt>(),
    eventLog: new Map<string, EventLog>(),
  };

  connect(): Promise<void> {
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise<void>((resolve, reject) => {
      let resolved = false;

      const finalizeConnect = (): void => {
        if (resolved) return;
        resolved = true;
        resolve();
      };

      this.conn = DbConnection.builder()
        .withUri(HOST)
        .withDatabaseName(DB_NAME)
        .withToken(localStorage.getItem("auth_token") || undefined)
        .onConnect((conn: DbConnection, identity: Identity, token: string) => {
          localStorage.setItem("auth_token", token);
          this.myPlayerId = identity.toHexString();

          this.attachTableListeners(conn);
          this.callReducer(["joinPlayer", "join_player"]).catch((error) => {
            console.error("joinPlayer failed:", error);
          });

          conn
            .subscriptionBuilder()
            .onApplied(() => {
              if (!this.hydrated) {
                this.hydrateFromDb(conn);
                this.hydrated = true;
                finalizeConnect();
              }
              this.queueNotify();
            })
            .subscribe([...CLIENT_SUBSCRIPTIONS]);
        })
        .onConnectError((_ctx, error: Error) => {
          if (!resolved) {
            reject(error);
          }
          console.error("SpacetimeDB connect error:", error);
        })
        .onDisconnect(() => {
          console.warn("Disconnected from SpacetimeDB");
        })
        .build();
    });

    return this.connectPromise;
  }

  onStoreChanged(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getMyPlayerId(): string | null {
    return this.myPlayerId;
  }

  getMyPlayer(): Player | null {
    if (!this.myPlayerId) return null;
    return this.store.players.get(this.myPlayerId) ?? null;
  }

  getSnapshot(): WorldSnapshot {
    return {
      myPlayerId: this.myPlayerId,
      worldState: this.store.worldState,
      worldConfig: this.store.worldConfig,
      players: sortByPlayerId(this.store.players.values()),
      obstacles: sortByStringId(this.store.obstacles.values()),
      junk: sortByStringId(this.store.junk.values()),
      generators: sortByStringId(this.store.generators.values()),
      lines: sortByStringId(this.store.lines.values()),
      rootNodes: sortByPlayerId(this.store.rootNodes.values()),
      rootRelocations: sortByPlayerId(this.store.rootRelocations.values()),
      captureAttempts: Array.from(this.store.captureAttempts.values()).sort((a, b) =>
        a.generatorId.localeCompare(b.generatorId),
      ),
      eventLog: sortByStringId(this.store.eventLog.values()),
      versions: { ...this.versions },
    };
  }

  setMoveTarget(targetPosX: bigint, targetPosY: bigint): Promise<void> {
    return this.callReducer(["setMoveTarget", "set_move_target"], {
      targetPosX,
      targetPosY,
    });
  }

  stopMove(): Promise<void> {
    return this.callReducer(["stopMove", "stop_move"]);
  }

  placeRoot(generatorId: string): Promise<void> {
    return this.callReducer(["placeRoot", "place_root"], { generatorId });
  }

  startMoveRoot(newGeneratorId: string): Promise<void> {
    return this.callReducer(["startMoveRoot", "start_move_root"], { newGeneratorId });
  }

  buildLine(aGeneratorId: string, bGeneratorId: string): Promise<void> {
    return this.callReducer(["buildLine", "build_line"], {
      aGeneratorId,
      bGeneratorId,
    });
  }

  destroyLine(lineId: string): Promise<void> {
    return this.callReducer(["destroyLine", "destroy_line"], { lineId });
  }

  startCaptureGenerator(generatorId: string): Promise<void> {
    return this.callReducer(
      ["startCaptureGenerator", "start_capture_generator"],
      { generatorId },
    );
  }

  cancelCapture(generatorId: string): Promise<void> {
    return this.callReducer(["cancelCapture", "cancel_capture"], {
      generatorId,
    });
  }

  private attachTableListeners(conn: DbConnection): void {
    const db = conn.db as any;

    const attachMapTable = <T>(
      tableName: string,
      tableVersion: VersionKey,
      map: Map<string, T>,
      keySelector: (row: T) => string,
    ): void => {
      const table = db[tableName];
      table.onInsert((_ctx: unknown, row: T) => {
        map.set(keySelector(row), row);
        this.bumpVersion(tableVersion);
      });
      if (typeof table.onUpdate === "function") {
        table.onUpdate((_ctx: unknown, _oldRow: T, newRow: T) => {
          map.set(keySelector(newRow), newRow);
          this.bumpVersion(tableVersion);
        });
      }
      if (typeof table.onDelete === "function") {
        table.onDelete((_ctx: unknown, row: T) => {
          map.delete(keySelector(row));
          this.bumpVersion(tableVersion);
        });
      }
    };

    const attachPlayerKeyTable = <T extends { playerId: string }>(
      tableName: string,
      tableVersion: VersionKey,
      map: Map<string, T>,
    ): void => {
      const table = db[tableName];
      table.onInsert((_ctx: unknown, row: T) => {
        map.set(row.playerId, row);
        this.bumpVersion(tableVersion);
      });
      if (typeof table.onUpdate === "function") {
        table.onUpdate((_ctx: unknown, _oldRow: T, newRow: T) => {
          map.set(newRow.playerId, newRow);
          this.bumpVersion(tableVersion);
        });
      }
      if (typeof table.onDelete === "function") {
        table.onDelete((_ctx: unknown, row: T) => {
          map.delete(row.playerId);
          this.bumpVersion(tableVersion);
        });
      }
    };

    db.worldState.onInsert((_ctx: unknown, row: WorldState) => {
      this.store.worldState = row;
      this.bumpVersion("worldState");
    });
    db.worldState.onUpdate((_ctx: unknown, _oldRow: WorldState, newRow: WorldState) => {
      this.store.worldState = newRow;
      this.bumpVersion("worldState");
    });

    db.worldConfig.onInsert((_ctx: unknown, row: WorldConfig) => {
      this.store.worldConfig = row;
      this.bumpVersion("worldConfig");
    });
    db.worldConfig.onUpdate((_ctx: unknown, _oldRow: WorldConfig, newRow: WorldConfig) => {
      this.store.worldConfig = newRow;
      this.bumpVersion("worldConfig");
    });

    attachPlayerKeyTable<Player>("player", "player", this.store.players);
    attachMapTable<Obstacle>(
      "obstacle",
      "obstacle",
      this.store.obstacles,
      (row) => row.id,
    );
    attachMapTable<Junk>("junk", "junk", this.store.junk, (row) => row.id);
    attachMapTable<Generator>(
      "generator",
      "generator",
      this.store.generators,
      (row) => row.id,
    );
    attachMapTable<Line>("line", "line", this.store.lines, (row) => row.id);
    attachPlayerKeyTable<RootNode>("rootNode", "rootNode", this.store.rootNodes);
    attachPlayerKeyTable<RootRelocation>(
      "rootRelocation",
      "rootRelocation",
      this.store.rootRelocations,
    );
    attachMapTable<CaptureAttempt>(
      "captureAttempt",
      "captureAttempt",
      this.store.captureAttempts,
      (row) => row.generatorId,
    );
    attachMapTable<EventLog>("eventLog", "eventLog", this.store.eventLog, (row) => row.id);
  }

  private hydrateFromDb(conn: DbConnection): void {
    this.store.worldState =
      (Array.from(conn.db.worldState.iter())[0] as WorldState | undefined) ?? null;
    this.store.worldConfig =
      (Array.from(conn.db.worldConfig.iter())[0] as WorldConfig | undefined) ?? null;

    this.replaceMap(this.store.players, Array.from(conn.db.player.iter()) as Player[], (x) => x.playerId, "player");
    this.replaceMap(this.store.obstacles, Array.from(conn.db.obstacle.iter()) as Obstacle[], (x) => x.id, "obstacle");
    this.replaceMap(this.store.junk, Array.from(conn.db.junk.iter()) as Junk[], (x) => x.id, "junk");
    this.replaceMap(this.store.generators, Array.from(conn.db.generator.iter()) as Generator[], (x) => x.id, "generator");
    this.replaceMap(this.store.lines, Array.from(conn.db.line.iter()) as Line[], (x) => x.id, "line");
    this.replaceMap(this.store.rootNodes, Array.from(conn.db.rootNode.iter()) as RootNode[], (x) => x.playerId, "rootNode");
    this.replaceMap(
      this.store.rootRelocations,
      Array.from(conn.db.rootRelocation.iter()) as RootRelocation[],
      (x) => x.playerId,
      "rootRelocation",
    );
    this.replaceMap(
      this.store.captureAttempts,
      Array.from(conn.db.captureAttempt.iter()) as CaptureAttempt[],
      (x) => x.generatorId,
      "captureAttempt",
    );
    this.replaceMap(this.store.eventLog, Array.from(conn.db.eventLog.iter()) as EventLog[], (x) => x.id, "eventLog");

    this.bumpVersion("worldState");
    this.bumpVersion("worldConfig");
  }

  private replaceMap<T>(
    map: Map<string, T>,
    rows: T[],
    keySelector: (row: T) => string,
    versionKey: VersionKey,
  ): void {
    map.clear();
    for (const row of rows) {
      map.set(keySelector(row), row);
    }
    this.bumpVersion(versionKey);
  }

  private bumpVersion(key: VersionKey): void {
    this.versions[key] += 1;
    this.queueNotify();
  }

  private queueNotify(): void {
    if (this.notifyQueued) {
      return;
    }
    this.notifyQueued = true;
    queueMicrotask(() => {
      this.notifyQueued = false;
      for (const listener of this.listeners) {
        listener();
      }
    });
  }

  private callReducer(names: string[], args?: unknown): Promise<void> {
    if (!this.conn) {
      throw new Error("Not connected");
    }

    const reducers = this.conn.reducers as unknown as ReducerMap;
    for (const name of names) {
      const reducer = reducers[name];
      if (typeof reducer !== "function") continue;
      if (args === undefined) {
        const promise = reducer();
        this.seq += 1;
        return promise;
      } else {
        const promise = reducer(args);
        this.seq += 1;
        return promise;
      }
    }

    throw new Error(`Reducer not found. Tried: ${names.join(", ")}`);
  }
}
