import { describe, expect, test } from "vitest";
import { DbConnection, tables } from "../client/module_bindings";

const shouldRun = process.env.RUN_SPACETIMEDB_INTEGRATION === "1";
type ReducerMap = Record<string, (args?: unknown) => unknown>;
const FIXED_SCALE = 1000n;

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

function centerFixed(cell: number): bigint {
  return BigInt(cell) * FIXED_SCALE + FIXED_SCALE / 2n;
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
        targetPosX: centerFixed(targetX),
        targetPosY: centerFixed(targetY),
      });

      const startTick = getCurrentTick(conn);
      await waitFor(() => getCurrentTick(conn) >= startTick + 10n, 10_000);
      await wait(120);

      const afterMove = getPlayer(conn, playerId);
      const afterDistance = manhattanDistance(afterMove, targetX, targetY);
      expect(afterDistance).toBeLessThan(beforeDistance);

      const beforeBlockedTarget = {
        targetPosX: readBigInt(afterMove, "targetPosX", "target_pos_x"),
        targetPosY: readBigInt(afterMove, "targetPosY", "target_pos_y"),
      };
      const obstacleRows = Array.from(conn.db.obstacle.iter()) as Array<
        Record<string, unknown>
      >;
      const obstacleTarget = obstacleRows[0] ?? {};
      const obstacleX = readNumber(obstacleTarget, "x");
      const obstacleY = readNumber(obstacleTarget, "y");
      expect(obstacleRows.length).toBeGreaterThan(0);
      try {
        callReducer(conn, ["setMoveTarget", "set_move_target"], {
          targetPosX: centerFixed(obstacleX),
          targetPosY: centerFixed(obstacleY),
        });
      } catch {
        // Reducer can throw synchronously on validation failures.
      }
      await wait(150);

      const afterBlockedAttempt = getPlayer(conn, playerId);
      const blockedTargetPosX = readBigInt(
        afterBlockedAttempt,
        "targetPosX",
        "target_pos_x",
      );
      const blockedTargetPosY = readBigInt(
        afterBlockedAttempt,
        "targetPosY",
        "target_pos_y",
      );
      expect(
        blockedTargetPosX === centerFixed(obstacleX) &&
          blockedTargetPosY === centerFixed(obstacleY),
      ).toBeFalsy();
      expect(
        blockedTargetPosX === beforeBlockedTarget.targetPosX &&
          blockedTargetPosY === beforeBlockedTarget.targetPosY,
      ).toBeTruthy();
    },
    20_000,
  );
});
