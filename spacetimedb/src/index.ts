import { ScheduleAt } from "spacetimedb";
import { schema, table, t } from "spacetimedb/server";

const WORLD_STATE_ID = "singleton";
const WORLD_CONFIG_ID = "singleton";
const TICK_SCHEDULER_ID = 1n;

const TICK_RATE = 20;
const TICK_INTERVAL_MICROS = 50_000n;
const ACTION_BUDGET_PER_TICK = 5;
const FIXED_SCALE = 1000n;
const SEED = 12345;

const DEFAULT_TICKS_PER_DAY = 20;
const DEFAULT_WAVE_EVERY_DAYS = 3;
const DEFAULT_MARKER_LEAD_DAYS = 1;
const DEFAULT_GENERATOR_LIFE_DAYS = 9;
const DEFAULT_WAVE_SIZE = 12;

const MAP_SIZE_CELLS = 128;
const MIN_GENERATOR_DIST_CELLS = 10;
const MAX_WAVE_GENERATION_ATTEMPTS = 256;

let scheduledTickRef: any;

interface WorldStateRow {
  id: string;
  currentTick: bigint;
  tickRate: number;
  seed: number;
}

interface WorldConfigRow {
  id: string;
  ticksPerDay: number;
  waveEveryDays: number;
  markerLeadDays: number;
  generatorLifeDays: number;
  waveSize: number;
}

interface PlayerRow {
  playerId: string;
  posX: bigint;
  posY: bigint;
  lastProcessedTick: bigint;
}

interface PlayerSessionRow {
  playerId: string;
  lastSeq: bigint;
  actionBudget: number;
  lastBudgetTick: bigint;
}

interface PendingActionRow {
  id: string;
  tick: bigint;
  playerId: string;
  seq: bigint;
  actionType: string;
  payloadJson: string;
  dx: number;
  dy: number;
}

interface ObstacleRow {
  id: string;
  x: number;
  y: number;
}

interface SpawnMarkerRow {
  id: string;
  x: number;
  y: number;
  spawnTick: bigint;
}

interface GeneratorRow {
  id: string;
  x: number;
  y: number;
  spawnTick: bigint;
  expireTick: bigint;
  ownerPlayerId: string;
  state: string;
}

interface GridCell {
  x: number;
  y: number;
}

interface WaveTiming {
  waveEveryTicks: bigint;
  markerLeadTicks: bigint;
  generatorLifeTicks: bigint;
  waveSize: number;
}

const worldStateTable = table(
  { public: true },
  {
    id: t.string().primaryKey(),
    currentTick: t.u64(),
    tickRate: t.u16(),
    seed: t.u32(),
  },
);

const worldConfigTable = table(
  { public: true },
  {
    id: t.string().primaryKey(),
    ticksPerDay: t.u32(),
    waveEveryDays: t.u32(),
    markerLeadDays: t.u32(),
    generatorLifeDays: t.u32(),
    waveSize: t.u32(),
  },
);

const playerTable = table(
  { public: true },
  {
    playerId: t.string().primaryKey(),
    posX: t.i64(),
    posY: t.i64(),
    lastProcessedTick: t.u64(),
  },
);

const playerSessionTable = table(
  { public: false },
  {
    playerId: t.string().primaryKey(),
    lastSeq: t.u64(),
    actionBudget: t.u16(),
    lastBudgetTick: t.u64(),
  },
);

const pendingActionTable = table(
  { public: true },
  {
    id: t.string().primaryKey(),
    tick: t.u64(),
    playerId: t.string(),
    seq: t.u64(),
    actionType: t.string(),
    payloadJson: t.string(),
    dx: t.i32(),
    dy: t.i32(),
  },
);

const obstacleTable = table(
  { public: true },
  {
    id: t.string().primaryKey(),
    x: t.i32(),
    y: t.i32(),
  },
);

const spawnMarkerTable = table(
  { public: true },
  {
    id: t.string().primaryKey(),
    x: t.i32(),
    y: t.i32(),
    spawnTick: t.u64(),
  },
);

const generatorTable = table(
  { public: true },
  {
    id: t.string().primaryKey(),
    x: t.i32(),
    y: t.i32(),
    spawnTick: t.u64(),
    expireTick: t.u64(),
    ownerPlayerId: t.string(),
    state: t.string(),
  },
);

const tickScheduleTable = table(
  {
    public: false,
    scheduled: () => scheduledTickRef,
  },
  {
    scheduled_id: t.u64().primaryKey(),
    scheduled_at: t.scheduleAt(),
  },
);

const spacetimedb = schema({
  worldState: worldStateTable,
  worldConfig: worldConfigTable,
  player: playerTable,
  playerSession: playerSessionTable,
  pendingAction: pendingActionTable,
  obstacle: obstacleTable,
  spawnMarker: spawnMarkerTable,
  generator: generatorTable,
  tickSchedule: tickScheduleTable,
});

export default spacetimedb;

const SEEDED_OBSTACLES: readonly ObstacleRow[] = [
  { id: "1:-2", x: 1, y: -2 },
  { id: "1:-1", x: 1, y: -1 },
  { id: "1:0", x: 1, y: 0 },
  { id: "1:1", x: 1, y: 1 },
  { id: "1:2", x: 1, y: 2 },
];

function cmpBigInt(a: bigint, b: bigint): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function cmpString(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function obstacleId(x: bigint, y: bigint): string {
  return `${x.toString()}:${y.toString()}`;
}

function spawnMarkerId(spawnTick: bigint, index: number): string {
  return `marker:${spawnTick.toString()}:${index}`;
}

function generatorIdFromMarkerId(markerId: string): string {
  if (markerId.startsWith("marker:")) {
    return `generator:${markerId.slice("marker:".length)}`;
  }
  return `generator:${markerId}`;
}

function toU32(value: number): number {
  return value >>> 0;
}

function xorshift32(state: number): number {
  let x = toU32(state);
  x ^= toU32(x << 13);
  x ^= toU32(x >>> 17);
  x ^= toU32(x << 5);
  return toU32(x);
}

function makeWaveSeed(seed: number, spawnTick: bigint): number {
  const low = Number(spawnTick & 0xffff_ffffn);
  const high = Number((spawnTick >> 32n) & 0xffff_ffffn);
  const mixed =
    toU32(seed) ^ toU32(low) ^ toU32(high * 1_664_525) ^ 0x9e37_79b9;
  return mixed === 0 ? 0x6d2b_79f5 : mixed;
}

function distSq(a: GridCell, b: GridCell): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function isFarEnough(
  candidate: GridCell,
  selected: GridCell[],
  minDistSq: number,
): boolean {
  for (const existing of selected) {
    if (distSq(candidate, existing) < minDistSq) {
      return false;
    }
  }
  return true;
}

function ensureWorldState(ctx: any): WorldStateRow {
  const existing = ctx.db.worldState.id.find(
    WORLD_STATE_ID,
  ) as WorldStateRow | null;
  if (existing) return existing;

  const created = {
    id: WORLD_STATE_ID,
    currentTick: 0n,
    tickRate: TICK_RATE,
    seed: SEED,
  };
  ctx.db.worldState.insert(created);
  return created;
}

function ensureWorldConfig(ctx: any): WorldConfigRow {
  const existing = ctx.db.worldConfig.id.find(
    WORLD_CONFIG_ID,
  ) as WorldConfigRow | null;
  if (existing) return existing;

  const created = {
    id: WORLD_CONFIG_ID,
    ticksPerDay: DEFAULT_TICKS_PER_DAY,
    waveEveryDays: DEFAULT_WAVE_EVERY_DAYS,
    markerLeadDays: DEFAULT_MARKER_LEAD_DAYS,
    generatorLifeDays: DEFAULT_GENERATOR_LIFE_DAYS,
    waveSize: DEFAULT_WAVE_SIZE,
  };
  ctx.db.worldConfig.insert(created);
  return created;
}

function ensureObstacles(ctx: any): void {
  for (const obstacle of SEEDED_OBSTACLES) {
    if (ctx.db.obstacle.id.find(obstacle.id)) continue;
    ctx.db.obstacle.insert(obstacle);
  }
}

function ensureTickSchedule(ctx: any): void {
  const existing = ctx.db.tickSchedule.scheduled_id.find(TICK_SCHEDULER_ID) as {
    scheduled_id: bigint;
    scheduled_at: unknown;
  } | null;
  if (existing) return;
  ctx.db.tickSchedule.insert({
    scheduled_id: TICK_SCHEDULER_ID,
    scheduled_at: ScheduleAt.interval(TICK_INTERVAL_MICROS),
  });
}

function waveTimingFromConfig(config: WorldConfigRow): WaveTiming {
  if (
    config.ticksPerDay <= 0 ||
    config.waveEveryDays <= 0 ||
    config.markerLeadDays <= 0 ||
    config.generatorLifeDays <= 0 ||
    config.waveSize <= 0
  ) {
    throw new Error("worldConfig values must be positive");
  }
  if (config.markerLeadDays >= config.waveEveryDays) {
    throw new Error("markerLeadDays must be < waveEveryDays");
  }

  const ticksPerDay = BigInt(config.ticksPerDay);
  return {
    waveEveryTicks: ticksPerDay * BigInt(config.waveEveryDays),
    markerLeadTicks: ticksPerDay * BigInt(config.markerLeadDays),
    generatorLifeTicks: ticksPerDay * BigInt(config.generatorLifeDays),
    waveSize: config.waveSize,
  };
}

function generateWaveCells(
  ctx: any,
  worldSeed: number,
  spawnTick: bigint,
  waveSize: number,
): GridCell[] {
  const selected: GridCell[] = [];
  const used = new Set<string>();
  let state = makeWaveSeed(worldSeed, spawnTick);

  for (
    let minDist = MIN_GENERATOR_DIST_CELLS;
    minDist >= 0 && selected.length < waveSize;
    minDist -= 1
  ) {
    const minDistSq = minDist * minDist;
    let attempts = 0;
    while (
      attempts < MAX_WAVE_GENERATION_ATTEMPTS &&
      selected.length < waveSize
    ) {
      attempts += 1;
      state = xorshift32(state);
      const x = state % MAP_SIZE_CELLS;
      state = xorshift32(state);
      const y = state % MAP_SIZE_CELLS;

      const key = `${x}:${y}`;
      if (used.has(key)) continue;
      if (ctx.db.obstacle.id.find(key)) continue;

      const candidate = { x, y };
      if (!isFarEnough(candidate, selected, minDistSq)) continue;

      used.add(key);
      selected.push(candidate);
    }
  }

  return selected;
}

function spawnWaveMarkers(
  ctx: any,
  world: WorldStateRow,
  timing: WaveTiming,
  currentTick: bigint,
): void {
  const spawnTick = currentTick + timing.markerLeadTicks;
  const positions = generateWaveCells(
    ctx,
    world.seed,
    spawnTick,
    timing.waveSize,
  );
  for (let i = 0; i < positions.length; i += 1) {
    const cell = positions[i];
    const id = spawnMarkerId(spawnTick, i);
    if (ctx.db.spawnMarker.id.find(id)) continue;
    ctx.db.spawnMarker.insert({
      id,
      x: cell.x,
      y: cell.y,
      spawnTick,
    });
  }
}

function materializeWaveGenerators(
  ctx: any,
  timing: WaveTiming,
  currentTick: bigint,
): void {
  const dueMarkers = (Array.from(ctx.db.spawnMarker.iter()) as SpawnMarkerRow[])
    .filter((marker) => marker.spawnTick === currentTick)
    .sort((a, b) => cmpString(a.id, b.id));

  for (const marker of dueMarkers) {
    const generatorId = generatorIdFromMarkerId(marker.id);
    if (!ctx.db.generator.id.find(generatorId)) {
      ctx.db.generator.insert({
        id: generatorId,
        x: marker.x,
        y: marker.y,
        spawnTick: currentTick,
        expireTick: currentTick + timing.generatorLifeTicks,
        ownerPlayerId: "",
        state: "neutral",
      });
    }
    ctx.db.spawnMarker.id.delete(marker.id);
  }
}

function cleanupExpiredGenerators(ctx: any, currentTick: bigint): void {
  const expired = (Array.from(ctx.db.generator.iter()) as GeneratorRow[])
    .filter((generator) => currentTick >= generator.expireTick)
    .sort((a, b) => cmpString(a.id, b.id));

  for (const generator of expired) {
    ctx.db.generator.id.delete(generator.id);
  }
}

function runWaveLifecycle(
  ctx: any,
  world: WorldStateRow,
  config: WorldConfigRow,
): void {
  const currentTick = world.currentTick;
  const timing = waveTimingFromConfig(config);

  const markerPhase = timing.waveEveryTicks - timing.markerLeadTicks;
  if (currentTick % timing.waveEveryTicks === markerPhase) {
    spawnWaveMarkers(ctx, world, timing, currentTick);
  }

  if (currentTick !== 0n && currentTick % timing.waveEveryTicks === 0n) {
    materializeWaveGenerators(ctx, timing, currentTick);
  }

  cleanupExpiredGenerators(ctx, currentTick);
}

function payloadToMove(payloadJson: string): { dx: number; dy: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    throw new Error("payloadJson must be valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("payloadJson must decode to object");
  }

  const payload = parsed as Record<string, unknown>;
  const dx = payload.dx;
  const dy = payload.dy;
  if (!Number.isInteger(dx) || !Number.isInteger(dy)) {
    throw new Error("Move payload requires integer dx/dy");
  }

  const move = { dx: dx as number, dy: dy as number };
  if (Math.abs(move.dx) + Math.abs(move.dy) > 1) {
    throw new Error("Move exceeds speed limit (1 cell per tick)");
  }
  return move;
}

function applyMoveInternal(
  ctx: any,
  playerId: string,
  dx: number,
  dy: number,
  currentTick: bigint,
): void {
  const player = ctx.db.player.playerId.find(playerId) as PlayerRow | null;
  if (!player) return;

  const currentCellX = player.posX / FIXED_SCALE;
  const currentCellY = player.posY / FIXED_SCALE;
  const nextCellX = currentCellX + BigInt(dx);
  const nextCellY = currentCellY + BigInt(dy);

  if (ctx.db.obstacle.id.find(obstacleId(nextCellX, nextCellY))) {
    return;
  }

  ctx.db.player.playerId.update({
    ...player,
    posX: player.posX + BigInt(dx) * FIXED_SCALE,
    posY: player.posY + BigInt(dy) * FIXED_SCALE,
    lastProcessedTick: currentTick,
  });
}

function processTick(ctx: any): void {
  const world = ensureWorldState(ctx);
  const config = ensureWorldConfig(ctx);
  runWaveLifecycle(ctx, world, config);

  const currentTick = world.currentTick;
  const due = (Array.from(ctx.db.pendingAction.iter()) as PendingActionRow[])
    .filter((action) => action.tick <= currentTick)
    .sort((a, b) => {
      return (
        cmpBigInt(a.tick, b.tick) ||
        cmpString(a.playerId, b.playerId) ||
        cmpBigInt(a.seq, b.seq) ||
        cmpString(a.id, b.id)
      );
    });

  for (const action of due) {
    if (action.actionType === "Move") {
      applyMoveInternal(
        ctx,
        action.playerId,
        action.dx,
        action.dy,
        currentTick,
      );
    }
    ctx.db.pendingAction.id.delete(action.id);
  }

  const nextTick = currentTick + 1n;
  const sessions = Array.from(
    ctx.db.playerSession.iter(),
  ) as PlayerSessionRow[];
  sessions.sort((a, b) => cmpString(a.playerId, b.playerId));
  for (const session of sessions) {
    ctx.db.playerSession.playerId.update({
      ...session,
      actionBudget: ACTION_BUDGET_PER_TICK,
      lastBudgetTick: nextTick,
    });
  }

  ctx.db.worldState.id.update({
    ...world,
    currentTick: nextTick,
  });
}

export const init = spacetimedb.init((ctx) => {
  ensureWorldState(ctx);
  ensureWorldConfig(ctx);
  ensureObstacles(ctx);
  ensureTickSchedule(ctx);
});

export const onConnect = spacetimedb.clientConnected((ctx) => {
  ensureWorldState(ctx);
  ensureWorldConfig(ctx);
  ensureObstacles(ctx);
});

export const joinPlayer = spacetimedb.reducer((ctx) => {
  const world = ensureWorldState(ctx);
  const playerId = ctx.sender.toHexString();

  const existingPlayer = ctx.db.player.playerId.find(
    playerId,
  ) as PlayerRow | null;
  if (!existingPlayer) {
    ctx.db.player.insert({
      playerId,
      posX: 0n,
      posY: 0n,
      lastProcessedTick: world.currentTick,
    });
  }

  const existingSession = ctx.db.playerSession.playerId.find(
    playerId,
  ) as PlayerSessionRow | null;
  if (!existingSession) {
    ctx.db.playerSession.insert({
      playerId,
      lastSeq: 0n,
      actionBudget: ACTION_BUDGET_PER_TICK,
      lastBudgetTick: world.currentTick,
    });
  }
});

export const enqueueAction = spacetimedb.reducer(
  {
    actionType: t.string(),
    tick: t.u64(),
    seq: t.u64(),
    payloadJson: t.string(),
  },
  (ctx, { actionType, tick, seq, payloadJson }) => {
    const world = ensureWorldState(ctx);
    const playerId = ctx.sender.toHexString();
    const session = ctx.db.playerSession.playerId.find(
      playerId,
    ) as PlayerSessionRow | null;
    if (!session) {
      throw new Error("player must call joinPlayer first");
    }

    const sessionForTick =
      session.lastBudgetTick === world.currentTick
        ? session
        : {
            ...session,
            actionBudget: ACTION_BUDGET_PER_TICK,
            lastBudgetTick: world.currentTick,
          };

    if (tick < world.currentTick) {
      throw new Error("tick must be >= currentTick");
    }
    if (seq <= sessionForTick.lastSeq) {
      throw new Error("seq must be > lastSeq");
    }
    if (sessionForTick.actionBudget <= 0) {
      throw new Error("rate limit exceeded");
    }

    if (actionType !== "Move") {
      throw new Error(`unsupported action type: ${actionType}`);
    }

    const { dx, dy } = payloadToMove(payloadJson);
    const id = `${playerId}:${seq.toString()}`;
    if (ctx.db.pendingAction.id.find(id)) {
      throw new Error(`duplicate pending action: ${id}`);
    }

    ctx.db.pendingAction.insert({
      id,
      tick,
      playerId,
      seq,
      actionType,
      payloadJson,
      dx,
      dy,
    });

    ctx.db.playerSession.playerId.update({
      ...sessionForTick,
      lastSeq: seq,
      actionBudget: sessionForTick.actionBudget - 1,
    });
  },
);

export const applyMove = spacetimedb.reducer(
  {
    playerId: t.string(),
    dx: t.i32(),
    dy: t.i32(),
    currentTick: t.u64(),
  },
  (ctx, { playerId, dx, dy, currentTick }) => {
    if (!ctx.senderAuth.isInternal) {
      throw new Error("applyMove is internal-only");
    }
    if (Math.abs(dx) + Math.abs(dy) > 1) {
      throw new Error("Move exceeds speed limit (1 cell per tick)");
    }
    applyMoveInternal(ctx, playerId, dx, dy, currentTick);
  },
);

export const tick = (scheduledTickRef = spacetimedb.reducer(
  { arg: tickScheduleTable.rowType },
  (ctx) => {
    if (!ctx.senderAuth.isInternal) {
      throw new Error("tick is internal-only");
    }
    processTick(ctx);
  },
));
