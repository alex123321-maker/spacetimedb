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

function getPlayer(conn: DbConnection, playerId: string): Record<string, unknown> {
  const players = Array.from(conn.db.player.iter()) as Array<Record<string, unknown>>;
  const found = players.find(
    (player) => readString(player, "playerId", "player_id") === playerId,
  );
  return found ?? {};
}

function getCurrentTick(conn: DbConnection): bigint {
  const world = Array.from(conn.db.worldState.iter())[0] as Record<string, unknown> | undefined;
  if (!world) return 0n;
  return readBigInt(world, "currentTick", "current_tick");
}

function manhattanDistance(
  player: Record<string, unknown>,
  targetX: number,
  targetY: number,
): number {
  const x = readNumber(player, "posX", "pos_x") / 1000;
  const y = readNumber(player, "posY", "pos_y") / 1000;
  return Math.abs(targetX - x) + Math.abs(targetY - y);
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

describe("SpacetimeDB move target integration", () => {
  test.runIf(shouldRun)(
    "setMoveTarget moves player toward target and rejects obstacle target",
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
        tables.player,
        tables.obstacle,
      ]);
      await wait(150);
      callReducer(conn, ["joinPlayer", "join_player"]);
      await wait(120);

      const targetX = 8;
      const targetY = 8;
      const before = getPlayer(conn, playerId);
      const beforeDistance = manhattanDistance(before, targetX, targetY);

      callReducer(conn, ["setMoveTarget", "set_move_target"], {
        cellX: targetX,
        cellY: targetY,
      });

      const startTick = getCurrentTick(conn);
      await waitFor(() => getCurrentTick(conn) >= startTick + 10n, 10_000);
      await wait(120);

      const afterMove = getPlayer(conn, playerId);
      const afterDistance = manhattanDistance(afterMove, targetX, targetY);
      expect(afterDistance).toBeLessThan(beforeDistance);

      const beforeBlockedTarget = {
        targetX: readNumber(afterMove, "targetX", "target_x"),
        targetY: readNumber(afterMove, "targetY", "target_y"),
      };
      try {
        callReducer(conn, ["setMoveTarget", "set_move_target"], {
          cellX: 1,
          cellY: 0,
        });
      } catch {
        // Reducer can throw synchronously on validation failures.
      }
      await wait(150);

      const afterBlockedAttempt = getPlayer(conn, playerId);
      const blockedTargetX = readNumber(afterBlockedAttempt, "targetX", "target_x");
      const blockedTargetY = readNumber(afterBlockedAttempt, "targetY", "target_y");
      expect(
        blockedTargetX === 1 && blockedTargetY === 0,
      ).toBeFalsy();
      expect(
        blockedTargetX === beforeBlockedTarget.targetX &&
          blockedTargetY === beforeBlockedTarget.targetY,
      ).toBeTruthy();
    },
    20_000,
  );
});

