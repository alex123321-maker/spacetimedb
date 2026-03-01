import { describe, expect, test } from "vitest";
import { DbConnection, tables } from "../client/module_bindings";

const shouldRun = process.env.RUN_SPACETIMEDB_INTEGRATION === "1";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readBigInt(row: Record<string, unknown>, ...keys: string[]): bigint {
  for (const key of keys) {
    if (key in row) return row[key] as bigint;
  }
  return 0n;
}

function readNumber(row: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    if (key in row) return row[key] as number;
  }
  return 0;
}

function getCurrentTick(conn: DbConnection): bigint {
  const world = Array.from(conn.db.worldState.iter())[0] as Record<string, unknown> | undefined;
  if (!world) return 0n;
  return readBigInt(world, "currentTick", "current_tick");
}

async function waitForPredicate(
  predicate: () => boolean,
  timeoutMs: number,
  pollMs = 50
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }
    await wait(pollMs);
  }
  throw new Error("Timed out while waiting for condition");
}

describe("SpacetimeDB generators integration", () => {
  test.runIf(shouldRun)(
    "spawn markers appear before wave, then generators spawn and expire",
    async () => {
      const host = process.env.STDB_HOST ?? "ws://127.0.0.1:3000";
      const dbName = process.env.STDB_DB_NAME ?? "continuum-grid";

      const conn = await new Promise<DbConnection>((resolve, reject) => {
        DbConnection.builder()
          .withUri(host)
          .withDatabaseName(dbName)
          .onConnect((connected) => resolve(connected))
          .onConnectError((_ctx, error) => reject(error))
          .build();
      });

      conn
        .subscriptionBuilder()
        .subscribe([
          tables.worldState,
          tables.worldConfig,
          tables.spawnMarker,
          tables.generator
        ]);
      await wait(150);

      const config = Array.from(conn.db.worldConfig.iter())[0] as Record<string, unknown> | undefined;
      expect(config).toBeDefined();

      const ticksPerDay = BigInt(readNumber(config ?? {}, "ticksPerDay", "ticks_per_day"));
      const waveEveryDays = BigInt(readNumber(config ?? {}, "waveEveryDays", "wave_every_days"));
      const markerLeadDays = BigInt(readNumber(config ?? {}, "markerLeadDays", "marker_lead_days"));
      const generatorLifeDays = BigInt(readNumber(config ?? {}, "generatorLifeDays", "generator_life_days"));

      const waveEvery = ticksPerDay * waveEveryDays;
      const lead = ticksPerDay * markerLeadDays;
      const life = ticksPerDay * generatorLifeDays;

      const now = getCurrentTick(conn);
      let waveTick = ((now / waveEvery) + 1n) * waveEvery;
      let markerTick = waveTick - lead;
      if (markerTick <= now) {
        waveTick += waveEvery;
        markerTick = waveTick - lead;
      }

      await waitForPredicate(() => getCurrentTick(conn) >= markerTick, 15_000);
      await wait(80);

      const markersAtWave = (Array.from(conn.db.spawnMarker.iter()) as Array<Record<string, unknown>>).filter(
        (marker) => readBigInt(marker, "spawnTick", "spawn_tick") === waveTick
      );
      expect(markersAtWave.length).toBeGreaterThan(0);

      await waitForPredicate(() => getCurrentTick(conn) >= waveTick, 15_000);
      await wait(120);

      const remainingMarkersAtWave = (Array.from(
        conn.db.spawnMarker.iter()
      ) as Array<Record<string, unknown>>).filter(
        (marker) => readBigInt(marker, "spawnTick", "spawn_tick") === waveTick
      );
      expect(remainingMarkersAtWave.length).toBe(0);

      const spawnedGenerators = (Array.from(conn.db.generator.iter()) as Array<
        Record<string, unknown>
      >).filter((generator) => readBigInt(generator, "spawnTick", "spawn_tick") === waveTick);
      expect(spawnedGenerators.length).toBeGreaterThan(0);

      const expireTick = waveTick + life;
      await waitForPredicate(() => getCurrentTick(conn) >= expireTick, 30_000);
      await wait(120);

      const generatorsAfterExpire = (Array.from(conn.db.generator.iter()) as Array<
        Record<string, unknown>
      >).filter((generator) => readBigInt(generator, "spawnTick", "spawn_tick") === waveTick);
      expect(generatorsAfterExpire.length).toBe(0);
    },
    60_000
  );
});
