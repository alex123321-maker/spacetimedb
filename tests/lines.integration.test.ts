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

function getCurrentTick(conn: DbConnection): bigint {
  const world = Array.from(conn.db.worldState.iter())[0] as Record<string, unknown> | undefined;
  if (!world) return 0n;
  return readBigInt(world, "currentTick", "current_tick");
}

function getNeutralGenerators(conn: DbConnection): Array<Record<string, unknown>> {
  const generators = Array.from(conn.db.generator.iter()) as Array<Record<string, unknown>>;
  return generators
    .filter(
      (generator) =>
        readString(generator, "state") === "neutral" &&
        readString(generator, "ownerPlayerId", "owner_player_id") === "",
    )
    .sort((a, b) => readString(a, "id").localeCompare(readString(b, "id")));
}

function getPlayer(conn: DbConnection, playerId: string): Record<string, unknown> | undefined {
  const players = Array.from(conn.db.player.iter()) as Array<Record<string, unknown>>;
  return players.find((player) => readString(player, "playerId", "player_id") === playerId);
}

function getPlayerLines(conn: DbConnection, playerId: string): Array<Record<string, unknown>> {
  const lines = Array.from(conn.db.line.iter()) as Array<Record<string, unknown>>;
  return lines
    .filter((line) => readString(line, "ownerPlayerId", "owner_player_id") === playerId)
    .sort((a, b) => readString(a, "id").localeCompare(readString(b, "id")));
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
    tables.line,
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

function getMaxLines(controlledCount: number): number {
  const maxLines =
    4 +
    controlledCount * 2 -
    Math.floor((controlledCount * controlledCount) / 10);
  return Math.max(4, maxLines);
}

describe("SpacetimeDB lines integration", () => {
  test.runIf(shouldRun)(
    "build/destroy line validations, ownership, and line limit",
    async () => {
      const host = process.env.STDB_HOST ?? "ws://127.0.0.1:3000";
      const dbName = process.env.STDB_DB_NAME ?? "continuum-grid";

      const a = await connectClient(host, dbName);
      const b = await connectClient(host, dbName);

      callReducer(a.conn, ["updateWorldConfig", "update_world_config"], {
        ticksPerDay: 5,
        ticksPerMinute: 1,
        waveEveryDays: 2,
        markerLeadDays: 1,
        generatorLifeDays: 200,
        waveSize: 20,
      });
      callReducer(a.conn, ["updateWorldViewConfig", "update_world_view_config"], {
        worldWidth: 128,
        worldHeight: 128,
        tileSizePx: 16,
        interactRangeCells: 1000,
      });
      callReducer(a.conn, ["setTestAdminMode", "set_test_admin_mode"], {
        enabled: true,
      });
      await wait(250);

      await waitFor(() => getNeutralGenerators(a.conn).length >= 8, 20_000);
      const firstNeutral = getNeutralGenerators(a.conn)[0];
      const rootGeneratorId = readString(firstNeutral, "id");

      // buildLine fails without root
      const lineCountBeforeNoRoot = getPlayerLines(b.conn, b.playerId).length;
      callReducer(b.conn, ["buildLine", "build_line"], {
        aGeneratorId: rootGeneratorId,
        bGeneratorId: rootGeneratorId,
      });
      await wait(150);
      expect(getPlayerLines(b.conn, b.playerId).length).toBe(lineCountBeforeNoRoot);

      // place root for player A
      callReducer(a.conn, ["placeRoot", "place_root"], {
        generatorId: rootGeneratorId,
      });
      await wait(150);

      // buildLine fails when second generator is not controlled
      const neutralForFailure = getNeutralGenerators(a.conn)
        .map((generator) => readString(generator, "id"))
        .find((id) => id !== rootGeneratorId);
      expect(neutralForFailure).toBeTruthy();

      const lineCountBeforeNotControlled = getPlayerLines(a.conn, a.playerId).length;
      callReducer(a.conn, ["buildLine", "build_line"], {
        aGeneratorId: rootGeneratorId,
        bGeneratorId: neutralForFailure,
      });
      await wait(150);
      expect(getPlayerLines(a.conn, a.playerId).length).toBe(lineCountBeforeNotControlled);

      // claim controlled generators for line scenarios
      const neutralIds = getNeutralGenerators(a.conn)
        .map((generator) => readString(generator, "id"))
        .filter((id) => id !== rootGeneratorId)
        .slice(0, 6);
      for (const generatorId of neutralIds) {
        callReducer(a.conn, ["adminClaimGenerator", "admin_claim_generator"], {
          generatorId,
        });
        await wait(60);
      }

      const controlledByA = (Array.from(a.conn.db.generator.iter()) as Array<
        Record<string, unknown>
      >)
        .filter(
          (generator) =>
            readString(generator, "ownerPlayerId", "owner_player_id") === a.playerId &&
            readString(generator, "state") === "controlled",
        )
        .sort((x, y) => readString(x, "id").localeCompare(readString(y, "id")));
      expect(controlledByA.length).toBeGreaterThanOrEqual(6);

      // buildLine success
      const gA = readString(controlledByA[0], "id");
      const gB = readString(controlledByA[1], "id");
      callReducer(a.conn, ["buildLine", "build_line"], {
        aGeneratorId: gA,
        bGeneratorId: gB,
      });
      await wait(180);

      const builtLines = getPlayerLines(a.conn, a.playerId);
      expect(builtLines.length).toBeGreaterThan(0);
      const builtLineId = readString(builtLines[0], "id");

      // destroyLine ownership: other player cannot delete
      const beforeForeignDestroy = getPlayerLines(a.conn, a.playerId).length;
      callReducer(b.conn, ["destroyLine", "destroy_line"], { lineId: builtLineId });
      await wait(150);
      expect(getPlayerLines(a.conn, a.playerId).length).toBe(beforeForeignDestroy);

      // owner can delete
      callReducer(a.conn, ["destroyLine", "destroy_line"], { lineId: builtLineId });
      await wait(150);
      expect(getPlayerLines(a.conn, a.playerId).length).toBe(beforeForeignDestroy - 1);

      // limit enforced
      const controlledIds = controlledByA.map((generator) => readString(generator, "id"));
      const targetMaxLines = getMaxLines(controlledIds.length);
      const builtPairIds = new Set<string>();
      const pairs: Array<[string, string]> = [];
      for (let i = 0; i < controlledIds.length; i += 1) {
        for (let j = i + 1; j < controlledIds.length; j += 1) {
          pairs.push([controlledIds[i], controlledIds[j]]);
        }
      }

      for (const [first, second] of pairs) {
        if (getPlayerLines(a.conn, a.playerId).length >= targetMaxLines) break;
        callReducer(a.conn, ["buildLine", "build_line"], {
          aGeneratorId: first,
          bGeneratorId: second,
        });
        await wait(70);
        const linesNow = getPlayerLines(a.conn, a.playerId);
        if (linesNow.length > builtPairIds.size) {
          builtPairIds.add(`${first}<->${second}`);
        }
      }

      const linesAtLimit = getPlayerLines(a.conn, a.playerId);
      expect(linesAtLimit.length).toBe(targetMaxLines);

      const extraPair = pairs.find(
        ([first, second]) => !builtPairIds.has(`${first}<->${second}`),
      );
      expect(extraPair).toBeDefined();
      const beforeExtraAttempt = getPlayerLines(a.conn, a.playerId).length;
      callReducer(a.conn, ["buildLine", "build_line"], {
        aGeneratorId: extraPair?.[0],
        bGeneratorId: extraPair?.[1],
      });
      await wait(120);
      expect(getPlayerLines(a.conn, a.playerId).length).toBe(beforeExtraAttempt);

      // ensure root still exists and no relocation loophole
      const aPlayer = getPlayer(a.conn, a.playerId);
      expect(readString(aPlayer ?? {}, "rootGeneratorId", "root_generator_id")).not.toBe("");
      const relocation = (Array.from(a.conn.db.rootRelocation.iter()) as Array<
        Record<string, unknown>
      >).find((row) => readString(row, "playerId", "player_id") === a.playerId);
      expect(relocation).toBeUndefined();
      expect(getCurrentTick(a.conn)).toBeGreaterThanOrEqual(0n);
    },
    120_000,
  );
});
