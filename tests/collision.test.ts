import { describe, expect, test } from "vitest";
import { DbConnection, tables } from "../client/module_bindings";

const shouldRun = process.env.RUN_SPACETIMEDB_INTEGRATION === "1";
const FIXED_SCALE = 1000n;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ReducerMap = Record<string, (args?: unknown) => unknown>;

describe("SpacetimeDB collision integration", () => {
  test.runIf(shouldRun)(
    "setMoveTarget rejects target inside obstacle cell",
    async () => {
      const host = process.env.STDB_HOST ?? "ws://127.0.0.1:3000";
      const dbName = process.env.STDB_DB_NAME ?? "continuum-grid";

      let myPlayerId = "";
      const conn = await new Promise<DbConnection>((resolve, reject) => {
        DbConnection.builder()
          .withUri(host)
          .withDatabaseName(dbName)
          .onConnect((connected, identity) => {
            myPlayerId = identity.toHexString();
            resolve(connected);
          })
          .onConnectError((_ctx, error) => {
            reject(error);
          })
          .build();
      });

      conn
        .subscriptionBuilder()
        .subscribe([tables.player, tables.worldState, tables.obstacle]);
      await wait(100);

      const obstacles = Array.from(conn.db.obstacle.iter()) as Array<
        Record<string, unknown>
      >;
      const adjacentObstacle = obstacles
        .map((obstacle) => ({
          x: Number((obstacle.x ?? 0) as number),
          y: Number((obstacle.y ?? 0) as number),
        }))
        .find((obstacle) => Math.abs(obstacle.x) + Math.abs(obstacle.y) === 1);
      expect(adjacentObstacle).toBeDefined();

      const reducers = conn.reducers as unknown as ReducerMap;
      const callReducer = (names: string[], args?: unknown): void => {
        for (const name of names) {
          const fn = reducers[name];
          if (!fn) continue;
          if (args === undefined) fn();
          else fn(args);
          return;
        }
        throw new Error(`Reducer not found: ${names.join(", ")}`);
      };

      callReducer(["joinPlayer", "join_player"]);
      await wait(50);

      const playersBefore = Array.from(conn.db.player.iter()) as Array<
        Record<string, unknown>
      >;
      const meBefore = playersBefore.find(
        (row) => (row.playerId ?? row.player_id) === myPlayerId,
      );
      expect(meBefore).toBeDefined();
      const prevTargetPosX = (meBefore?.targetPosX ?? meBefore?.target_pos_x ?? 0n) as bigint;
      const prevTargetPosY = (meBefore?.targetPosY ?? meBefore?.target_pos_y ?? 0n) as bigint;

      const obstacleTargetPosX =
        BigInt(adjacentObstacle?.x ?? 1) * FIXED_SCALE + FIXED_SCALE / 2n;
      const obstacleTargetPosY =
        BigInt(adjacentObstacle?.y ?? 0) * FIXED_SCALE + FIXED_SCALE / 2n;
      try {
        callReducer(["setMoveTarget", "set_move_target"], {
          targetPosX: obstacleTargetPosX,
          targetPosY: obstacleTargetPosY,
        });
      } catch {
        // Reducer can throw synchronously.
      }

      await wait(150);

      const playersAfter = Array.from(conn.db.player.iter()) as Array<
        Record<string, unknown>
      >;
      const meAfter = playersAfter.find(
        (row) => (row.playerId ?? row.player_id) === myPlayerId
      );

      expect(meAfter).toBeDefined();
      const nextTargetPosX = (meAfter?.targetPosX ?? meAfter?.target_pos_x ?? 0n) as bigint;
      const nextTargetPosY = (meAfter?.targetPosY ?? meAfter?.target_pos_y ?? 0n) as bigint;
      expect(nextTargetPosX === obstacleTargetPosX).toBeFalsy();
      expect(nextTargetPosY === obstacleTargetPosY).toBeFalsy();
      expect(nextTargetPosX).toBe(prevTargetPosX);
      expect(nextTargetPosY).toBe(prevTargetPosY);
    },
    15_000
  );
});
