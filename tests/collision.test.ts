import { describe, expect, test } from "vitest";
import { DbConnection, tables } from "../client/module_bindings";
import { fx } from "../shared/fixed";

const shouldRun = process.env.RUN_SPACETIMEDB_INTEGRATION === "1";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ReducerMap = Record<string, (args?: unknown) => unknown>;

describe("SpacetimeDB collision integration", () => {
  test.runIf(shouldRun)(
    "Move into obstacle (1,0) is blocked",
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
      const hasObstacleAt10 = obstacles.some((obstacle) => {
        const x = Number((obstacle.x ?? 0) as number);
        const y = Number((obstacle.y ?? 0) as number);
        return x === 1 && y === 0;
      });
      expect(hasObstacleAt10).toBe(true);

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

      const worldRows = Array.from(conn.db.worldState.iter()) as Array<
        Record<string, unknown>
      >;
      const currentTick = Number(
        (worldRows[0]?.currentTick ?? worldRows[0]?.current_tick ?? 0n) as bigint
      );

      callReducer(["enqueueAction", "enqueue_action"], {
        actionType: "Move",
        tick: BigInt(currentTick + 1),
        seq: 1n,
        payloadJson: JSON.stringify({ dx: 1, dy: 0 })
      });

      await wait(250);

      const players = Array.from(conn.db.player.iter()) as Array<
        Record<string, unknown>
      >;
      const me = players.find(
        (row) => (row.playerId ?? row.player_id) === myPlayerId
      );

      expect(me).toBeDefined();
      const posX = Number((me?.posX ?? me?.pos_x ?? 0n) as bigint);
      const posY = Number((me?.posY ?? me?.pos_y ?? 0n) as bigint);
      expect(posX).toBe(fx(0));
      expect(posY).toBe(fx(0));
    },
    15_000
  );
});
