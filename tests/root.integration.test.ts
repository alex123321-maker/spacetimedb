import { describe, expect, test } from "vitest";
import { DbConnection, tables } from "../client/module_bindings";

const shouldRun = process.env.RUN_SPACETIMEDB_INTEGRATION === "1";

type ReducerMap = Record<string, (args?: unknown) => unknown>;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readBigInt(row: Record<string, unknown>, ...keys: string[]): bigint {
  for (const key of keys) {
    if (key in row) return row[key] as bigint;
  }
  return 0n;
}

function readString(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    if (key in row) return (row[key] as string) ?? "";
  }
  return "";
}

function getCurrentTick(conn: DbConnection): bigint {
  const world = Array.from(conn.db.worldState.iter())[0] as Record<string, unknown> | undefined;
  if (!world) return 0n;
  return readBigInt(world, "currentTick", "current_tick");
}

function findPlayer(conn: DbConnection, playerId: string): Record<string, unknown> | undefined {
  const players = Array.from(conn.db.player.iter()) as Array<Record<string, unknown>>;
  return players.find((player) => readString(player, "playerId", "player_id") === playerId);
}

function findGenerator(conn: DbConnection, generatorId: string): Record<string, unknown> | undefined {
  const generators = Array.from(conn.db.generator.iter()) as Array<Record<string, unknown>>;
  return generators.find((generator) => readString(generator, "id") === generatorId);
}

function getNeutralGeneratorId(conn: DbConnection, excludedIds: Set<string>): string | null {
  const generators = Array.from(conn.db.generator.iter()) as Array<Record<string, unknown>>;
  const neutral = generators
    .filter((generator) => {
      const id = readString(generator, "id");
      const owner = readString(generator, "ownerPlayerId", "owner_player_id");
      const state = readString(generator, "state");
      return !excludedIds.has(id) && state === "neutral" && owner === "";
    })
    .sort((a, b) => readString(a, "id").localeCompare(readString(b, "id")));
  if (neutral.length === 0) return null;
  return readString(neutral[0], "id");
}

function getPlayerRoot(player: Record<string, unknown> | undefined): string {
  if (!player) return "";
  return readString(player, "rootGeneratorId", "root_generator_id");
}

function getPlayerRootMoveAvailableAt(player: Record<string, unknown> | undefined): bigint {
  if (!player) return 0n;
  return readBigInt(
    player,
    "rootMoveAvailableAtTick",
    "root_move_available_at_tick",
  );
}

function callReducer(conn: DbConnection, names: string[], args?: unknown): void {
  const reducers = conn.reducers as unknown as ReducerMap;
  for (const name of names) {
    const fn = reducers[name];
    if (!fn) continue;
    if (args === undefined) fn();
    else fn(args);
    return;
  }
  throw new Error(`Reducer not found: ${names.join(", ")}`);
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
    tables.rootRelocation,
  ]);
  await wait(150);
  callReducer(conn, ["joinPlayer", "join_player"]);
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
  throw new Error("Timed out while waiting for predicate");
}

describe("SpacetimeDB root integration", () => {
  test.runIf(shouldRun)(
    "place root, validate non-neutral rejection, move with timing, and root cleanup on generator expiry",
    async () => {
      const host = process.env.STDB_HOST ?? "ws://127.0.0.1:3000";
      const dbName = process.env.STDB_DB_NAME ?? "continuum-grid";

      const a = await connectClient(host, dbName);
      const b = await connectClient(host, dbName);

      callReducer(a.conn, ["updateWorldConfig", "update_world_config"], {
        ticksPerDay: 10,
        ticksPerMinute: 1,
        waveEveryDays: 2,
        markerLeadDays: 1,
        generatorLifeDays: 60,
        waveSize: 12,
      });
      await wait(250);

      await waitFor(
        () => getNeutralGeneratorId(a.conn, new Set()) !== null,
        20_000,
      );

      const firstRootGeneratorId = getNeutralGeneratorId(a.conn, new Set());
      expect(firstRootGeneratorId).toBeTruthy();

      callReducer(a.conn, ["placeRoot", "place_root"], {
        generatorId: firstRootGeneratorId,
      });
      await wait(200);

      const aAfterPlace = findPlayer(a.conn, a.playerId);
      expect(getPlayerRoot(aAfterPlace)).toBe(firstRootGeneratorId);
      const controlledGenerator = findGenerator(a.conn, firstRootGeneratorId as string);
      expect(readString(controlledGenerator ?? {}, "state")).toBe("controlled");
      expect(
        readString(controlledGenerator ?? {}, "ownerPlayerId", "owner_player_id"),
      ).toBe(a.playerId);

      callReducer(b.conn, ["placeRoot", "place_root"], {
        generatorId: firstRootGeneratorId,
      });
      await wait(200);
      const bAfterFailedPlace = findPlayer(b.conn, b.playerId);
      expect(getPlayerRoot(bAfterFailedPlace)).toBe("");

      const moveTargetBeforeCooldown = getNeutralGeneratorId(
        a.conn,
        new Set([firstRootGeneratorId as string]),
      );
      expect(moveTargetBeforeCooldown).toBeTruthy();

      callReducer(a.conn, ["startMoveRoot", "start_move_root"], {
        newGeneratorId: moveTargetBeforeCooldown,
      });
      await wait(200);
      const relocBeforeCooldown = (Array.from(
        a.conn.db.rootRelocation.iter(),
      ) as Array<Record<string, unknown>>).find(
        (row) => readString(row, "playerId", "player_id") === a.playerId,
      );
      expect(relocBeforeCooldown).toBeUndefined();

      const cooldownTargetTick = getPlayerRootMoveAvailableAt(aAfterPlace);
      await waitFor(() => getCurrentTick(a.conn) >= cooldownTargetTick, 30_000);

      const moveTargetAfterCooldown = getNeutralGeneratorId(
        a.conn,
        new Set([firstRootGeneratorId as string]),
      );
      expect(moveTargetAfterCooldown).toBeTruthy();

      callReducer(a.conn, ["startMoveRoot", "start_move_root"], {
        newGeneratorId: moveTargetAfterCooldown,
      });
      await wait(200);

      const relocation = (Array.from(
        a.conn.db.rootRelocation.iter(),
      ) as Array<Record<string, unknown>>).find(
        (row) => readString(row, "playerId", "player_id") === a.playerId,
      );
      expect(relocation).toBeDefined();
      const finishTick = readBigInt(relocation ?? {}, "finishTick", "finish_tick");

      await waitFor(() => getCurrentTick(a.conn) >= finishTick, 10_000);
      await wait(250);

      const relocationAfterFinish = (Array.from(
        a.conn.db.rootRelocation.iter(),
      ) as Array<Record<string, unknown>>).find(
        (row) => readString(row, "playerId", "player_id") === a.playerId,
      );
      expect(relocationAfterFinish).toBeUndefined();

      const aAfterMove = findPlayer(a.conn, a.playerId);
      expect(getPlayerRoot(aAfterMove)).toBe(moveTargetAfterCooldown);
      const oldGeneratorAfterMove = findGenerator(a.conn, firstRootGeneratorId as string);
      expect(readString(oldGeneratorAfterMove ?? {}, "state")).toBe("neutral");

      callReducer(a.conn, ["updateWorldConfig", "update_world_config"], {
        ticksPerDay: 5,
        ticksPerMinute: 1,
        waveEveryDays: 2,
        markerLeadDays: 1,
        generatorLifeDays: 2,
        waveSize: 8,
      });
      await wait(250);

      const configChangeTick = getCurrentTick(a.conn);
      await waitFor(
        () => {
          const neutral = getNeutralGeneratorId(a.conn, new Set());
          if (!neutral) return false;
          const gen = findGenerator(a.conn, neutral);
          const spawnTick = readBigInt(gen ?? {}, "spawnTick", "spawn_tick");
          return spawnTick >= configChangeTick;
        },
        20_000,
      );

      const cRootGenerator = (() => {
        const generators = Array.from(a.conn.db.generator.iter()) as Array<
          Record<string, unknown>
        >;
        const candidates = generators
          .filter((generator) => {
            const owner = readString(generator, "ownerPlayerId", "owner_player_id");
            const state = readString(generator, "state");
            if (!(owner === "" && state === "neutral")) return false;
            const spawnTick = readBigInt(generator, "spawnTick", "spawn_tick");
            return spawnTick >= configChangeTick;
          })
          .sort((x, y) => readString(x, "id").localeCompare(readString(y, "id")));
        return candidates.length > 0 ? readString(candidates[0], "id") : "";
      })();
      expect(cRootGenerator).not.toBe("");

      callReducer(b.conn, ["placeRoot", "place_root"], {
        generatorId: cRootGenerator,
      });
      await wait(200);

      const bAfterPlace = findPlayer(b.conn, b.playerId);
      expect(getPlayerRoot(bAfterPlace)).toBe(cRootGenerator);
      const bRootGenerator = findGenerator(b.conn, cRootGenerator);
      const expireTick = readBigInt(bRootGenerator ?? {}, "expireTick", "expire_tick");
      expect(expireTick).toBeGreaterThan(getCurrentTick(b.conn));

      await waitFor(() => getCurrentTick(b.conn) > expireTick, 20_000);
      await wait(250);

      const bAfterExpire = findPlayer(b.conn, b.playerId);
      expect(getPlayerRoot(bAfterExpire)).toBe("");
    },
    120_000,
  );
});
