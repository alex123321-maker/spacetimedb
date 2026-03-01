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

function readBool(row: Record<string, unknown>, ...keys: string[]): boolean {
  for (const key of keys) {
    if (key in row) return Boolean(row[key]);
  }
  return false;
}

function readNumber(row: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    if (key in row) return Number(row[key]);
  }
  return 0;
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

function lineIdFor(playerId: string, aId: string, bId: string): string {
  const a = aId <= bId ? aId : bId;
  const b = aId <= bId ? bId : aId;
  return `${playerId}:${a}<->${b}`;
}

function getGenerator(conn: DbConnection, generatorId: string): Record<string, unknown> | undefined {
  const rows = Array.from(conn.db.generator.iter()) as Array<Record<string, unknown>>;
  return rows.find((row) => readString(row, "id") === generatorId);
}

function getLine(conn: DbConnection, lineId: string): Record<string, unknown> | undefined {
  const rows = Array.from(conn.db.line.iter()) as Array<Record<string, unknown>>;
  return rows.find((row) => readString(row, "id") === lineId);
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

describe("SpacetimeDB network solve integration", () => {
  test.runIf(shouldRun)(
    "connectivity, flow aggregation, and overheat isolation",
    async () => {
      const host = process.env.STDB_HOST ?? "ws://127.0.0.1:3000";
      const dbName = process.env.STDB_DB_NAME ?? "continuum-grid";

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
      ]);
      await wait(200);
      callReducer(conn, ["joinPlayer", "join_player"]);
      await wait(100);

      callReducer(conn, ["updateWorldConfig", "update_world_config"], {
        ticksPerDay: 10,
        ticksPerMinute: 1,
        waveEveryDays: 2,
        markerLeadDays: 1,
        generatorLifeDays: 300,
        waveSize: 16,
      });
      callReducer(conn, ["updateWorldViewConfig", "update_world_view_config"], {
        worldWidth: 128,
        worldHeight: 128,
        tileSizePx: 16,
        interactRangeCells: 1000,
      });
      callReducer(conn, ["setTestAdminMode", "set_test_admin_mode"], {
        enabled: true,
      });
      await wait(250);

      await waitFor(() => {
        const rows = Array.from(conn.db.generator.iter()) as Array<Record<string, unknown>>;
        const neutral = rows.filter(
          (row) =>
            readString(row, "state") === "neutral" &&
            readString(row, "ownerPlayerId", "owner_player_id") === "",
        );
        return neutral.length >= 3;
      }, 20_000);

      const neutralIds = (Array.from(conn.db.generator.iter()) as Array<
        Record<string, unknown>
      >)
        .filter(
          (row) =>
            readString(row, "state") === "neutral" &&
            readString(row, "ownerPlayerId", "owner_player_id") === "",
        )
        .map((row) => readString(row, "id"))
        .sort((a, b) => a.localeCompare(b));

      const rootId = neutralIds[0];
      const g1 = neutralIds[1];
      const g2 = neutralIds[2];

      callReducer(conn, ["placeRoot", "place_root"], { generatorId: rootId });
      callReducer(conn, ["adminClaimGenerator", "admin_claim_generator"], {
        generatorId: g1,
      });
      callReducer(conn, ["adminClaimGenerator", "admin_claim_generator"], {
        generatorId: g2,
      });
      await wait(200);

      callReducer(conn, ["buildLine", "build_line"], {
        aGeneratorId: rootId,
        bGeneratorId: g1,
      });
      callReducer(conn, ["buildLine", "build_line"], {
        aGeneratorId: g1,
        bGeneratorId: g2,
      });

      const rootToG1 = lineIdFor(playerId, rootId, g1);
      const g1ToG2 = lineIdFor(playerId, g1, g2);

      await waitFor(() => {
        const g1Row = getGenerator(conn, g1);
        const g2Row = getGenerator(conn, g2);
        return (
          readBool(g1Row ?? {}, "isConnected", "is_connected") &&
          readBool(g2Row ?? {}, "isConnected", "is_connected")
        );
      }, 10_000);

      await waitFor(() => {
        const nearLine = getLine(conn, rootToG1);
        const farLine = getLine(conn, g1ToG2);
        return (
          readNumber(nearLine ?? {}, "load") === 200 &&
          readNumber(farLine ?? {}, "load") === 100
        );
      }, 10_000);

      // Connectivity break after destroy.
      callReducer(conn, ["destroyLine", "destroy_line"], {
        lineId: g1ToG2,
      });
      await waitFor(() => {
        const g2Row = getGenerator(conn, g2);
        return !readBool(g2Row ?? {}, "isConnected", "is_connected");
      }, 10_000);

      // Rebuild chain and wait for overheat to disable a line.
      callReducer(conn, ["buildLine", "build_line"], {
        aGeneratorId: g1,
        bGeneratorId: g2,
      });
      await waitFor(() => {
        const nearLine = getLine(conn, rootToG1);
        return nearLine ? readBool(nearLine, "active") : false;
      }, 10_000);

      await waitFor(() => {
        const nearLine = getLine(conn, rootToG1);
        if (!nearLine) return false;
        const active = readBool(nearLine, "active");
        const cooldownUntil = readBigInt(
          nearLine,
          "cooldownUntilTick",
          "cooldown_until_tick",
        );
        return !active && cooldownUntil > getCurrentTick(conn);
      }, 45_000, 100);

      const g2AfterOverheat = getGenerator(conn, g2);
      expect(readBool(g2AfterOverheat ?? {}, "isConnected", "is_connected")).toBe(
        false,
      );
    },
    120_000,
  );
});
