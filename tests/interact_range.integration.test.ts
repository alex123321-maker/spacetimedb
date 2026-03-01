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

function readNumber(row: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    if (key in row) return Number(row[key] as number | bigint);
  }
  return 0;
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

function playerCell(player: Record<string, unknown>): { x: number; y: number } {
  return {
    x: Math.trunc(readNumber(player, "posX", "pos_x") / 1000),
    y: Math.trunc(readNumber(player, "posY", "pos_y") / 1000),
  };
}

function getPlayer(conn: DbConnection, playerId: string): Record<string, unknown> {
  const players = Array.from(conn.db.player.iter()) as Array<Record<string, unknown>>;
  const found = players.find(
    (player) => readString(player, "playerId", "player_id") === playerId,
  );
  return found ?? {};
}

function getRangeCells(conn: DbConnection): number {
  const config = Array.from(conn.db.worldConfig.iter())[0] as Record<string, unknown> | undefined;
  if (!config) return 0;
  return readNumber(config, "interactRangeCells", "interact_range_cells");
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

function distanceSq(
  player: Record<string, unknown>,
  generator: Record<string, unknown>,
): number {
  const p = playerCell(player);
  const dx = p.x - readNumber(generator, "x");
  const dy = p.y - readNumber(generator, "y");
  return dx * dx + dy * dy;
}

describe("SpacetimeDB interact range integration", () => {
  test.runIf(shouldRun)(
    "placeRoot fails out of range and succeeds when player moves close enough",
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
        tables.rootNode,
      ]);
      await wait(150);
      callReducer(conn, ["joinPlayer", "join_player"]);
      await wait(120);

      callReducer(conn, ["updateWorldConfig", "update_world_config"], {
        ticksPerDay: 5,
        ticksPerMinute: 1,
        waveEveryDays: 2,
        markerLeadDays: 1,
        generatorLifeDays: 200,
        waveSize: 16,
      });
      callReducer(conn, ["updateWorldViewConfig", "update_world_view_config"], {
        worldWidth: 128,
        worldHeight: 128,
        tileSizePx: 16,
        interactRangeCells: 3,
      });
      await wait(250);

      await waitFor(() => getNeutralGenerators(conn).length > 0, 20_000);

      const range = getRangeCells(conn);
      const me = getPlayer(conn, playerId);
      const farGenerator = getNeutralGenerators(conn)
        .filter((generator) => distanceSq(me, generator) > range * range)
        .sort((a, b) => distanceSq(me, b) - distanceSq(me, a))[0];
      expect(farGenerator).toBeDefined();

      const farGeneratorId = readString(farGenerator ?? {}, "id");
      callReducer(conn, ["placeRoot", "place_root"], { generatorId: farGeneratorId });
      await wait(150);

      const afterFarPlace = getPlayer(conn, playerId);
      expect(readString(afterFarPlace, "rootGeneratorId", "root_generator_id")).toBe("");

      callReducer(conn, ["setMoveTarget", "set_move_target"], {
        cellX: readNumber(farGenerator ?? {}, "x"),
        cellY: readNumber(farGenerator ?? {}, "y"),
      });

      await waitFor(
        () =>
          distanceSq(getPlayer(conn, playerId), farGenerator ?? {}) <= range * range,
        20_000,
      );
      await wait(120);

      callReducer(conn, ["stopMove", "stop_move"]);
      callReducer(conn, ["placeRoot", "place_root"], { generatorId: farGeneratorId });
      await wait(200);

      const afterNearPlace = getPlayer(conn, playerId);
      expect(readString(afterNearPlace, "rootGeneratorId", "root_generator_id")).toBe(
        farGeneratorId,
      );
    },
    60_000,
  );
});

