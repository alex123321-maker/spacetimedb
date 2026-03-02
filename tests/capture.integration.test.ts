import { describe, expect, test } from "vitest";
import { DbConnection, tables } from "../client/module_bindings";

const shouldRun = process.env.RUN_SPACETIMEDB_INTEGRATION === "1";
type ReducerMap = Record<string, (args?: unknown) => unknown>;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readString(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    if (key in row) return (row[key] as string) ?? "";
  }
  return "";
}

function readBigInt(row: Record<string, unknown>, ...keys: string[]): bigint {
  for (const key of keys) {
    if (key in row) return row[key] as bigint;
  }
  return 0n;
}

async function callReducer(
  conn: DbConnection,
  names: string[],
  args?: unknown,
): Promise<void> {
  const reducers = conn.reducers as unknown as ReducerMap;
  for (const name of names) {
    const fn = reducers[name];
    if (!fn) continue;
    await Promise.resolve(args === undefined ? fn() : fn(args));
    return;
  }
  throw new Error(`Reducer not found: ${names.join(", ")}`);
}

async function callReducerExpectError(
  conn: DbConnection,
  names: string[],
  args?: unknown,
): Promise<unknown> {
  try {
    await callReducer(conn, names, args);
    return null;
  } catch (error) {
    return error;
  }
}

function getCurrentTick(conn: DbConnection): bigint {
  const row = Array.from(conn.db.worldState.iter())[0] as Record<string, unknown> | undefined;
  if (!row) return 0n;
  return readBigInt(row, "currentTick", "current_tick");
}

function getGenerator(
  conn: DbConnection,
  generatorId: string,
): Record<string, unknown> | undefined {
  const rows = Array.from(conn.db.generator.iter()) as Array<Record<string, unknown>>;
  return rows.find((row) => readString(row, "id") === generatorId);
}

function getCaptureAttempt(
  conn: DbConnection,
  generatorId: string,
): Record<string, unknown> | undefined {
  const rows = Array.from(conn.db.captureAttempt.iter()) as Array<Record<string, unknown>>;
  return rows.find(
    (row) => readString(row, "generatorId", "generator_id") === generatorId,
  );
}

function getNeutralGenerators(conn: DbConnection): Array<Record<string, unknown>> {
  return (Array.from(conn.db.generator.iter()) as Array<Record<string, unknown>>)
    .filter(
      (row) =>
        readString(row, "state") === "neutral" &&
        readString(row, "ownerPlayerId", "owner_player_id") === "",
    )
    .sort((a, b) => readString(a, "id").localeCompare(readString(b, "id")));
}

function getPlayer(
  conn: DbConnection,
  playerId: string,
): Record<string, unknown> | undefined {
  const players = Array.from(conn.db.player.iter()) as Array<Record<string, unknown>>;
  return players.find((row) => readString(row, "playerId", "player_id") === playerId);
}

async function connectClient(host: string, dbName: string): Promise<{
  conn: DbConnection;
  playerId: string;
}> {
  let playerId = "";
  const conn = await new Promise<DbConnection>((resolve, reject) => {
    DbConnection.builder()
      .withUri(host)
      .withDatabaseName(dbName)
      .onConnect((connected, identity) => {
        playerId = identity.toHexString();
        resolve(connected);
      })
      .onConnectError((_ctx, error) => reject(error))
      .build();
  });

  conn.subscriptionBuilder().subscribe([
    tables.worldState,
    tables.worldConfig,
    tables.player,
    tables.generator,
    tables.rootNode,
    tables.captureAttempt,
    tables.eventLog,
  ]);
  await wait(160);
  await callReducer(conn, ["joinPlayer", "join_player"]);
  await wait(100);

  return { conn, playerId };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  pollMs = 50,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await wait(pollMs);
  }
  throw new Error("Timed out while waiting for condition");
}

describe("SpacetimeDB capture integration", () => {
  test.runIf(shouldRun)(
    "capture success",
    async () => {
      const host = process.env.STDB_HOST ?? "ws://127.0.0.1:3000";
      const dbName = process.env.STDB_DB_NAME ?? "continuum-grid";
      const a = await connectClient(host, dbName);

      await callReducer(a.conn, ["setTestAdminMode", "set_test_admin_mode"], {
        enabled: true,
      });
      await callReducer(a.conn, ["updateWorldConfig", "update_world_config"], {
        ticksPerDay: 8,
        ticksPerMinute: 1,
        waveEveryDays: 2,
        markerLeadDays: 1,
        generatorLifeDays: 120,
        waveSize: 14,
      });
      await callReducer(a.conn, ["updateWorldViewConfig", "update_world_view_config"], {
        worldWidth: 128,
        worldHeight: 128,
        tileSizePx: 16,
        interactRangeCells: 1000,
      });
      await wait(220);

      await waitFor(() => getNeutralGenerators(a.conn).length >= 3, 20_000);

      const neutral = getNeutralGenerators(a.conn);
      const rootId = readString(neutral[0], "id");
      const targetId = readString(neutral[1], "id");
      await callReducer(a.conn, ["placeRoot", "place_root"], { generatorId: rootId });
      await wait(150);

      await callReducer(a.conn, ["startCaptureGenerator", "start_capture_generator"], {
        generatorId: targetId,
      });

      const attempt = getCaptureAttempt(a.conn, targetId);
      expect(attempt).toBeDefined();
      const finishTick = readBigInt(attempt ?? {}, "finishTick", "finish_tick");

      await waitFor(() => getCurrentTick(a.conn) >= finishTick, 20_000);
      await wait(180);

      const captured = getGenerator(a.conn, targetId);
      expect(readString(captured ?? {}, "state")).toBe("controlled");
      expect(readString(captured ?? {}, "ownerPlayerId", "owner_player_id")).toBe(
        a.playerId,
      );
      expect(
        readString(captured ?? {}, "reservedByPlayerId", "reserved_by_player_id"),
      ).toBe("");
      expect(getCaptureAttempt(a.conn, targetId)).toBeUndefined();
    },
    120_000,
  );

  test.runIf(shouldRun)(
    "capture race",
    async () => {
      const host = process.env.STDB_HOST ?? "ws://127.0.0.1:3000";
      const dbName = process.env.STDB_DB_NAME ?? "continuum-grid";
      const a = await connectClient(host, dbName);
      const b = await connectClient(host, dbName);

      await callReducer(a.conn, ["setTestAdminMode", "set_test_admin_mode"], {
        enabled: true,
      });
      await callReducer(a.conn, ["updateWorldConfig", "update_world_config"], {
        ticksPerDay: 8,
        ticksPerMinute: 1,
        waveEveryDays: 2,
        markerLeadDays: 1,
        generatorLifeDays: 120,
        waveSize: 16,
      });
      await callReducer(a.conn, ["updateWorldViewConfig", "update_world_view_config"], {
        worldWidth: 128,
        worldHeight: 128,
        tileSizePx: 16,
        interactRangeCells: 1000,
      });
      await wait(250);

      await waitFor(() => getNeutralGenerators(a.conn).length >= 4, 20_000);
      const neutral = getNeutralGenerators(a.conn);
      const aRootId = readString(neutral[0], "id");
      const bRootId = readString(neutral[1], "id");
      const targetId = readString(neutral[2], "id");

      await callReducer(a.conn, ["placeRoot", "place_root"], { generatorId: aRootId });
      await callReducer(b.conn, ["placeRoot", "place_root"], { generatorId: bRootId });
      await wait(150);

      await callReducer(a.conn, ["startCaptureGenerator", "start_capture_generator"], {
        generatorId: targetId,
      });
      const secondError = await callReducerExpectError(
        b.conn,
        ["startCaptureGenerator", "start_capture_generator"],
        { generatorId: targetId },
      );
      expect(secondError).toBeTruthy();

      const attempt = getCaptureAttempt(a.conn, targetId);
      expect(attempt).toBeDefined();
      expect(readString(attempt ?? {}, "playerId", "player_id")).toBe(a.playerId);

      const finishTick = readBigInt(attempt ?? {}, "finishTick", "finish_tick");
      await waitFor(() => getCurrentTick(a.conn) >= finishTick, 20_000);
      await wait(180);

      const captured = getGenerator(a.conn, targetId);
      expect(readString(captured ?? {}, "ownerPlayerId", "owner_player_id")).toBe(
        a.playerId,
      );
    },
    120_000,
  );

  test.runIf(shouldRun)(
    "capture fails if root is lost before completion",
    async () => {
      const host = process.env.STDB_HOST ?? "ws://127.0.0.1:3000";
      const dbName = process.env.STDB_DB_NAME ?? "continuum-grid";
      const a = await connectClient(host, dbName);

      await callReducer(a.conn, ["setTestAdminMode", "set_test_admin_mode"], {
        enabled: true,
      });
      await callReducer(a.conn, ["updateWorldConfig", "update_world_config"], {
        ticksPerDay: 5,
        ticksPerMinute: 1,
        waveEveryDays: 2,
        markerLeadDays: 1,
        generatorLifeDays: 3,
        waveSize: 16,
      });
      await callReducer(a.conn, ["updateWorldViewConfig", "update_world_view_config"], {
        worldWidth: 128,
        worldHeight: 128,
        tileSizePx: 16,
        interactRangeCells: 1000,
      });
      await wait(250);

      await waitFor(() => getNeutralGenerators(a.conn).length >= 2, 20_000);
      const initialNeutral = getNeutralGenerators(a.conn).sort((x, y) =>
        readBigInt(x, "spawnTick", "spawn_tick") <
        readBigInt(y, "spawnTick", "spawn_tick")
          ? -1
          : 1,
      );
      const rootId = readString(initialNeutral[0], "id");
      await callReducer(a.conn, ["placeRoot", "place_root"], { generatorId: rootId });
      await wait(120);

      const root = getGenerator(a.conn, rootId);
      const rootExpireTick = readBigInt(root ?? {}, "expireTick", "expire_tick");

      await waitFor(() => {
        const rootSpawn = readBigInt(root ?? {}, "spawnTick", "spawn_tick");
        return getNeutralGenerators(a.conn).some(
          (row) => readBigInt(row, "spawnTick", "spawn_tick") > rootSpawn,
        );
      }, 20_000);

      const rootSpawn = readBigInt(root ?? {}, "spawnTick", "spawn_tick");
      const target = getNeutralGenerators(a.conn)
        .filter((row) => readBigInt(row, "spawnTick", "spawn_tick") > rootSpawn)
        .sort((x, y) => readString(x, "id").localeCompare(readString(y, "id")))[0];
      expect(target).toBeDefined();
      const targetId = readString(target ?? {}, "id");

      await callReducer(a.conn, ["startCaptureGenerator", "start_capture_generator"], {
        generatorId: targetId,
      });

      const attempt = getCaptureAttempt(a.conn, targetId);
      expect(attempt).toBeDefined();
      const finishTick = readBigInt(attempt ?? {}, "finishTick", "finish_tick");

      await waitFor(() => getCurrentTick(a.conn) > rootExpireTick, 30_000);
      await waitFor(() => getCurrentTick(a.conn) >= finishTick, 30_000);
      await wait(180);

      const playerAfter = getPlayer(a.conn, a.playerId);
      expect(readString(playerAfter ?? {}, "rootGeneratorId", "root_generator_id")).toBe(
        "",
      );
      const targetAfter = getGenerator(a.conn, targetId);
      expect(readString(targetAfter ?? {}, "ownerPlayerId", "owner_player_id")).not.toBe(
        a.playerId,
      );
      expect(getCaptureAttempt(a.conn, targetId)).toBeUndefined();
    },
    120_000,
  );

  test.runIf(shouldRun)(
    "capture attempt is cleaned up when target expires",
    async () => {
      const host = process.env.STDB_HOST ?? "ws://127.0.0.1:3000";
      const dbName = process.env.STDB_DB_NAME ?? "continuum-grid";
      const a = await connectClient(host, dbName);

      await callReducer(a.conn, ["setTestAdminMode", "set_test_admin_mode"], {
        enabled: true,
      });
      await callReducer(a.conn, ["updateWorldConfig", "update_world_config"], {
        ticksPerDay: 5,
        ticksPerMinute: 1,
        waveEveryDays: 2,
        markerLeadDays: 1,
        generatorLifeDays: 1,
        waveSize: 12,
      });
      await callReducer(a.conn, ["updateWorldViewConfig", "update_world_view_config"], {
        worldWidth: 128,
        worldHeight: 128,
        tileSizePx: 16,
        interactRangeCells: 1000,
      });
      await wait(260);

      await waitFor(() => getNeutralGenerators(a.conn).length >= 2, 20_000);
      const neutral = getNeutralGenerators(a.conn);
      const rootId = readString(neutral[0], "id");
      const targetId = readString(neutral[1], "id");
      await callReducer(a.conn, ["placeRoot", "place_root"], { generatorId: rootId });
      await wait(120);

      const targetBefore = getGenerator(a.conn, targetId);
      const targetExpireTick = readBigInt(targetBefore ?? {}, "expireTick", "expire_tick");
      await callReducer(a.conn, ["startCaptureGenerator", "start_capture_generator"], {
        generatorId: targetId,
      });

      await waitFor(() => getCurrentTick(a.conn) > targetExpireTick, 20_000);
      await wait(180);

      expect(getGenerator(a.conn, targetId)).toBeUndefined();
      expect(getCaptureAttempt(a.conn, targetId)).toBeUndefined();
    },
    120_000,
  );
});

