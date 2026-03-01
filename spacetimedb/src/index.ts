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
const DEFAULT_TICKS_PER_MINUTE = 1;
const ROOT_MOVE_COOLDOWN_DAYS = 24;
const ROOT_MOVE_DURATION_MINUTES = 10;
const DEFAULT_LINE_CAPACITY = 150;
const DEFAULT_GENERATOR_OUTPUT = 100;
const LINE_COOLDOWN_MINUTES = 2;
const LINE_COOL_RATE_PER_TICK = 1;
const NETWORK_SOLVE_SAFETY_TICKS = 20n;
const MAX_NETWORK_SOLVE_PASSES = 8;

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
  ticksPerMinute: number;
  waveEveryDays: number;
  markerLeadDays: number;
  generatorLifeDays: number;
  waveSize: number;
  enableTestAdmin: boolean;
}

interface PlayerRow {
  playerId: string;
  posX: bigint;
  posY: bigint;
  lastProcessedTick: bigint;
  rootGeneratorId: string;
  rootMoveAvailableAtTick: bigint;
  networkDirty: boolean;
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
  isConnected: boolean;
  output: number;
  effectiveOutput: number;
  lastNetworkSolveTick: bigint;
}

interface LineRow {
  id: string;
  ownerPlayerId: string;
  aGeneratorId: string;
  bGeneratorId: string;
  length: number;
  capacity: number;
  load: number;
  temp: number;
  overheated: boolean;
  active: boolean;
  cooldownUntilTick: bigint;
  createdAtTick: bigint;
}

interface RootNodeRow {
  playerId: string;
  generatorId: string;
  placedAtTick: bigint;
}

interface RootRelocationRow {
  playerId: string;
  fromGeneratorId: string;
  toGeneratorId: string;
  startTick: bigint;
  finishTick: bigint;
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
    ticksPerMinute: t.u32(),
    waveEveryDays: t.u32(),
    markerLeadDays: t.u32(),
    generatorLifeDays: t.u32(),
    waveSize: t.u32(),
    enableTestAdmin: t.bool(),
  },
);

const playerTable = table(
  { public: true },
  {
    playerId: t.string().primaryKey(),
    posX: t.i64(),
    posY: t.i64(),
    lastProcessedTick: t.u64(),
    rootGeneratorId: t.string(),
    rootMoveAvailableAtTick: t.u64(),
    networkDirty: t.bool(),
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
    isConnected: t.bool(),
    output: t.i32(),
    effectiveOutput: t.i32(),
    lastNetworkSolveTick: t.u64(),
  },
);

const lineTable = table(
  { public: true },
  {
    id: t.string().primaryKey(),
    ownerPlayerId: t.string(),
    aGeneratorId: t.string(),
    bGeneratorId: t.string(),
    length: t.i32(),
    capacity: t.i32(),
    load: t.i32(),
    temp: t.i32(),
    overheated: t.bool(),
    active: t.bool(),
    cooldownUntilTick: t.u64(),
    createdAtTick: t.u64(),
  },
);

const rootNodeTable = table(
  { public: true },
  {
    playerId: t.string().primaryKey(),
    generatorId: t.string(),
    placedAtTick: t.u64(),
  },
);

const rootRelocationTable = table(
  { public: true },
  {
    playerId: t.string().primaryKey(),
    fromGeneratorId: t.string(),
    toGeneratorId: t.string(),
    startTick: t.u64(),
    finishTick: t.u64(),
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
  line: lineTable,
  rootNode: rootNodeTable,
  rootRelocation: rootRelocationTable,
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

function makeLineId(
  playerId: string,
  aGeneratorId: string,
  bGeneratorId: string,
): string {
  const aMin = aGeneratorId <= bGeneratorId ? aGeneratorId : bGeneratorId;
  const bMax = aGeneratorId <= bGeneratorId ? bGeneratorId : aGeneratorId;
  return `${playerId}:${aMin}<->${bMax}`;
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

function manhattanDistance(a: GridCell, b: GridCell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function clampInt(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
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
    ticksPerMinute: DEFAULT_TICKS_PER_MINUTE,
    waveEveryDays: DEFAULT_WAVE_EVERY_DAYS,
    markerLeadDays: DEFAULT_MARKER_LEAD_DAYS,
    generatorLifeDays: DEFAULT_GENERATOR_LIFE_DAYS,
    waveSize: DEFAULT_WAVE_SIZE,
    enableTestAdmin: false,
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
    config.ticksPerMinute <= 0 ||
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

function rootMoveCooldownTicks(config: WorldConfigRow): bigint {
  return BigInt(config.ticksPerDay) * BigInt(ROOT_MOVE_COOLDOWN_DAYS);
}

function rootMoveDurationTicks(config: WorldConfigRow): bigint {
  return BigInt(config.ticksPerMinute) * BigInt(ROOT_MOVE_DURATION_MINUTES);
}

function setGeneratorControl(
  ctx: any,
  generator: GeneratorRow,
  ownerPlayerId: string,
  state: "neutral" | "controlled" | "isolated",
): void {
  const isConnected =
    ownerPlayerId !== "" && state === "controlled"
      ? generator.isConnected
      : false;
  const effectiveOutput =
    ownerPlayerId !== "" && state === "controlled"
      ? generator.effectiveOutput
      : 0;
  ctx.db.generator.id.update({
    ...generator,
    ownerPlayerId,
    state,
    isConnected,
    effectiveOutput,
  });
}

function lineCooldownTicks(config: WorldConfigRow): bigint {
  return BigInt(config.ticksPerMinute) * BigInt(LINE_COOLDOWN_MINUTES);
}

function countControlledGenerators(ctx: any, playerId: string): number {
  return (Array.from(ctx.db.generator.iter()) as GeneratorRow[]).filter(
    (generator) =>
      generator.ownerPlayerId === playerId && generator.state === "controlled",
  ).length;
}

function countPlayerLines(ctx: any, playerId: string): number {
  return (Array.from(ctx.db.line.iter()) as LineRow[]).filter(
    (line) => line.ownerPlayerId === playerId,
  ).length;
}

function getMaxLines(controlledCount: number): number {
  const maxLines =
    4 +
    controlledCount * 2 -
    Math.floor((controlledCount * controlledCount) / 10);
  return Math.max(4, maxLines);
}

function removePlayerLinesTouchingGenerator(
  ctx: any,
  playerId: string,
  generatorId: string,
): void {
  const lines = (Array.from(ctx.db.line.iter()) as LineRow[])
    .filter(
      (line) =>
        line.ownerPlayerId === playerId &&
        (line.aGeneratorId === generatorId ||
          line.bGeneratorId === generatorId),
    )
    .sort((a, b) => cmpString(a.id, b.id));

  for (const line of lines) {
    ctx.db.line.id.delete(line.id);
  }
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
        isConnected: false,
        output: DEFAULT_GENERATOR_OUTPUT,
        effectiveOutput: 0,
        lastNetworkSolveTick: currentTick,
      });
    }
    ctx.db.spawnMarker.id.delete(marker.id);
  }
}

function processCompletedRootRelocations(
  ctx: any,
  config: WorldConfigRow,
  currentTick: bigint,
): void {
  const dueRelocations = (
    Array.from(ctx.db.rootRelocation.iter()) as RootRelocationRow[]
  )
    .filter((relocation) => relocation.finishTick <= currentTick)
    .sort((a, b) => cmpString(a.playerId, b.playerId));

  for (const relocation of dueRelocations) {
    const releaseTargetIfReserved = (): void => {
      const target = ctx.db.generator.id.find(
        relocation.toGeneratorId,
      ) as GeneratorRow | null;
      if (
        target &&
        target.state === "isolated" &&
        target.ownerPlayerId === ""
      ) {
        setGeneratorControl(ctx, target, "", "neutral");
      }
    };

    const player = ctx.db.player.playerId.find(
      relocation.playerId,
    ) as PlayerRow | null;
    if (!player || player.rootGeneratorId !== relocation.fromGeneratorId) {
      releaseTargetIfReserved();
      ctx.db.rootRelocation.playerId.delete(relocation.playerId);
      continue;
    }

    const toGenerator = ctx.db.generator.id.find(
      relocation.toGeneratorId,
    ) as GeneratorRow | null;
    if (!toGenerator || toGenerator.state !== "isolated") {
      releaseTargetIfReserved();
      ctx.db.rootRelocation.playerId.delete(relocation.playerId);
      continue;
    }

    const fromGenerator = ctx.db.generator.id.find(
      relocation.fromGeneratorId,
    ) as GeneratorRow | null;
    if (fromGenerator && fromGenerator.ownerPlayerId === relocation.playerId) {
      setGeneratorControl(ctx, fromGenerator, "", "neutral");
      removePlayerLinesTouchingGenerator(
        ctx,
        relocation.playerId,
        relocation.fromGeneratorId,
      );
    }

    setGeneratorControl(ctx, toGenerator, relocation.playerId, "controlled");

    ctx.db.player.playerId.update({
      ...player,
      rootGeneratorId: relocation.toGeneratorId,
      rootMoveAvailableAtTick: currentTick + rootMoveCooldownTicks(config),
      networkDirty: true,
    });

    const existingRoot = ctx.db.rootNode.playerId.find(
      relocation.playerId,
    ) as RootNodeRow | null;
    if (existingRoot) {
      ctx.db.rootNode.playerId.update({
        ...existingRoot,
        generatorId: relocation.toGeneratorId,
        placedAtTick: currentTick,
      });
    } else {
      ctx.db.rootNode.insert({
        playerId: relocation.playerId,
        generatorId: relocation.toGeneratorId,
        placedAtTick: currentTick,
      });
    }

    ctx.db.rootRelocation.playerId.delete(relocation.playerId);
  }
}

function cleanupExpiredGenerators(ctx: any, currentTick: bigint): void {
  const expired = (Array.from(ctx.db.generator.iter()) as GeneratorRow[])
    .filter((generator) => currentTick >= generator.expireTick)
    .sort((a, b) => cmpString(a.id, b.id));

  for (const generator of expired) {
    const attachedLines = (Array.from(ctx.db.line.iter()) as LineRow[])
      .filter(
        (line) =>
          line.aGeneratorId === generator.id ||
          line.bGeneratorId === generator.id,
      )
      .sort((a, b) => cmpString(a.id, b.id));

    for (const line of attachedLines) {
      const owner = ctx.db.player.playerId.find(
        line.ownerPlayerId,
      ) as PlayerRow | null;
      if (owner) {
        ctx.db.player.playerId.update({
          ...owner,
          networkDirty: true,
        });
      }
      ctx.db.line.id.delete(line.id);
    }

    const rootedPlayers = (Array.from(ctx.db.player.iter()) as PlayerRow[])
      .filter((player) => player.rootGeneratorId === generator.id)
      .sort((a, b) => cmpString(a.playerId, b.playerId));

    for (const player of rootedPlayers) {
      const relocation = ctx.db.rootRelocation.playerId.find(
        player.playerId,
      ) as RootRelocationRow | null;
      if (relocation) {
        const target = ctx.db.generator.id.find(
          relocation.toGeneratorId,
        ) as GeneratorRow | null;
        if (
          target &&
          target.state === "isolated" &&
          target.ownerPlayerId === ""
        ) {
          setGeneratorControl(ctx, target, "", "neutral");
        }
      }

      ctx.db.player.playerId.update({
        ...player,
        rootGeneratorId: "",
        networkDirty: true,
      });
      ctx.db.rootNode.playerId.delete(player.playerId);
      ctx.db.rootRelocation.playerId.delete(player.playerId);
    }

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

interface SolveEdge {
  to: string;
  lineId: string;
  weight: number;
}

interface DijkstraResult {
  connected: Set<string>;
  dist: Map<string, number>;
  parentGen: Map<string, string>;
  parentLine: Map<string, string>;
}

function pickBestUnvisited(
  nodes: string[],
  visited: Set<string>,
  dist: Map<string, number>,
): string | null {
  let best: string | null = null;
  let bestDist = Number.MAX_SAFE_INTEGER;
  for (const nodeId of nodes) {
    if (visited.has(nodeId)) continue;
    const nodeDist = dist.get(nodeId) ?? Number.MAX_SAFE_INTEGER;
    if (nodeDist < bestDist) {
      best = nodeId;
      bestDist = nodeDist;
      continue;
    }
    if (nodeDist === bestDist && best !== null && nodeId < best) {
      best = nodeId;
    }
  }
  return best;
}

function runDijkstraFromRoot(
  nodes: string[],
  rootGeneratorId: string,
  adjacency: Map<string, SolveEdge[]>,
): DijkstraResult {
  const dist = new Map<string, number>();
  const parentGen = new Map<string, string>();
  const parentLine = new Map<string, string>();
  for (const nodeId of nodes) {
    dist.set(nodeId, Number.MAX_SAFE_INTEGER);
  }
  if (!dist.has(rootGeneratorId)) {
    return { connected: new Set(), dist, parentGen, parentLine };
  }
  dist.set(rootGeneratorId, 0);

  const visited = new Set<string>();
  while (true) {
    const current = pickBestUnvisited(nodes, visited, dist);
    if (!current) break;
    const currentDist = dist.get(current) ?? Number.MAX_SAFE_INTEGER;
    if (currentDist === Number.MAX_SAFE_INTEGER) break;
    visited.add(current);

    const edges = adjacency.get(current) ?? [];
    for (const edge of edges) {
      const nextDist = currentDist + edge.weight;
      const oldDist = dist.get(edge.to) ?? Number.MAX_SAFE_INTEGER;
      if (nextDist < oldDist) {
        dist.set(edge.to, nextDist);
        parentGen.set(edge.to, current);
        parentLine.set(edge.to, edge.lineId);
        continue;
      }
      if (nextDist !== oldDist) continue;

      const oldParent = parentGen.get(edge.to);
      const oldParentLine = parentLine.get(edge.to);
      if (!oldParent || !oldParentLine) {
        parentGen.set(edge.to, current);
        parentLine.set(edge.to, edge.lineId);
        continue;
      }
      if (
        current < oldParent ||
        (current === oldParent && edge.lineId < oldParentLine)
      ) {
        parentGen.set(edge.to, current);
        parentLine.set(edge.to, edge.lineId);
      }
    }
  }

  const connected = new Set<string>();
  for (const nodeId of nodes) {
    if (
      (dist.get(nodeId) ?? Number.MAX_SAFE_INTEGER) !== Number.MAX_SAFE_INTEGER
    ) {
      connected.add(nodeId);
    }
  }
  return { connected, dist, parentGen, parentLine };
}

function solvePlayerNetwork(
  ctx: any,
  config: WorldConfigRow,
  currentTick: bigint,
  playerId: string,
): void {
  const player = ctx.db.player.playerId.find(playerId) as PlayerRow | null;
  if (!player) return;

  const controlledGenerators = (
    Array.from(ctx.db.generator.iter()) as GeneratorRow[]
  )
    .filter(
      (generator) =>
        generator.ownerPlayerId === playerId &&
        generator.state === "controlled",
    )
    .sort((a, b) => cmpString(a.id, b.id));
  const generatorById = new Map(
    controlledGenerators.map((generator) => [generator.id, generator]),
  );

  let lines = (Array.from(ctx.db.line.iter()) as LineRow[])
    .filter((line) => line.ownerPlayerId === playerId)
    .sort((a, b) => cmpString(a.id, b.id));

  const cooldownTicks = lineCooldownTicks(config);
  let lastConnected = new Set<string>();

  for (let pass = 0; pass < MAX_NETWORK_SOLVE_PASSES; pass += 1) {
    const normalizedLines: LineRow[] = [];
    for (const line of lines) {
      let next = line;
      const a = generatorById.get(line.aGeneratorId);
      const b = generatorById.get(line.bGeneratorId);
      const expectedLength =
        a && b
          ? manhattanDistance({ x: a.x, y: a.y }, { x: b.x, y: b.y })
          : line.length;
      if (line.length !== expectedLength) {
        next = { ...next, length: expectedLength };
      }

      const shouldBeActive = line.cooldownUntilTick <= currentTick;
      if (line.active !== shouldBeActive) {
        next = { ...next, active: shouldBeActive };
      }
      normalizedLines.push(next);
    }
    lines = normalizedLines;

    const adjacency = new Map<string, SolveEdge[]>();
    for (const generator of controlledGenerators) {
      adjacency.set(generator.id, []);
    }

    for (const line of lines) {
      if (!line.active) continue;
      const a = generatorById.get(line.aGeneratorId);
      const b = generatorById.get(line.bGeneratorId);
      if (!a || !b) continue;

      const weight = line.length;
      (adjacency.get(a.id) as SolveEdge[]).push({
        to: b.id,
        lineId: line.id,
        weight,
      });
      (adjacency.get(b.id) as SolveEdge[]).push({
        to: a.id,
        lineId: line.id,
        weight,
      });
    }

    for (const edges of adjacency.values()) {
      edges.sort((x, y) => {
        if (x.weight !== y.weight) return x.weight - y.weight;
        if (x.to !== y.to) return cmpString(x.to, y.to);
        return cmpString(x.lineId, y.lineId);
      });
    }

    const nodeIds = controlledGenerators.map((generator) => generator.id);
    const dijkstra = runDijkstraFromRoot(
      nodeIds,
      player.rootGeneratorId,
      adjacency,
    );
    const nodeFlow = new Map<string, number>();
    for (const generator of controlledGenerators) {
      nodeFlow.set(
        generator.id,
        dijkstra.connected.has(generator.id) ? generator.output : 0,
      );
    }

    const lineLoads = new Map<string, number>();
    for (const line of lines) {
      lineLoads.set(line.id, 0);
    }

    const descending = controlledGenerators.slice().sort((x, y) => {
      const dx = dijkstra.dist.get(x.id) ?? Number.MAX_SAFE_INTEGER;
      const dy = dijkstra.dist.get(y.id) ?? Number.MAX_SAFE_INTEGER;
      if (dx !== dy) return dy - dx;
      return cmpString(x.id, y.id);
    });

    for (const generator of descending) {
      if (generator.id === player.rootGeneratorId) continue;
      if (!dijkstra.connected.has(generator.id)) continue;

      const parentId = dijkstra.parentGen.get(generator.id);
      const parentLineId = dijkstra.parentLine.get(generator.id);
      if (!parentId || !parentLineId) continue;

      const flow = nodeFlow.get(generator.id) ?? 0;
      lineLoads.set(parentLineId, (lineLoads.get(parentLineId) ?? 0) + flow);
      nodeFlow.set(parentId, (nodeFlow.get(parentId) ?? 0) + flow);
    }

    let disabledByOverheat = false;
    const nextLines: LineRow[] = [];
    for (const line of lines) {
      const load = line.active ? (lineLoads.get(line.id) ?? 0) : 0;
      const heat =
        line.capacity > 0 ? Math.floor((load * 10) / line.capacity) : 0;
      const temp = clampInt(line.temp + heat - LINE_COOL_RATE_PER_TICK, 0, 200);
      const overheated = temp >= 100;
      let active = line.active;
      let cooldownUntilTick = line.cooldownUntilTick;

      if (line.cooldownUntilTick > currentTick) {
        active = false;
      } else if (overheated) {
        if (line.active) {
          disabledByOverheat = true;
        }
        active = false;
        cooldownUntilTick = currentTick + cooldownTicks;
      } else {
        active = true;
      }

      const next: LineRow = {
        ...line,
        load,
        temp,
        overheated,
        active,
        cooldownUntilTick,
      };
      if (
        next.length !== line.length ||
        next.load !== line.load ||
        next.temp !== line.temp ||
        next.overheated !== line.overheated ||
        next.active !== line.active ||
        next.cooldownUntilTick !== line.cooldownUntilTick
      ) {
        ctx.db.line.id.update(next);
      }
      nextLines.push(next);
    }

    lines = nextLines.sort((a, b) => cmpString(a.id, b.id));
    lastConnected = dijkstra.connected;

    if (!disabledByOverheat) {
      break;
    }
  }

  for (const generator of controlledGenerators) {
    const isConnected = lastConnected.has(generator.id);
    const effectiveOutput = isConnected ? generator.output : 0;
    if (
      generator.isConnected !== isConnected ||
      generator.effectiveOutput !== effectiveOutput ||
      generator.lastNetworkSolveTick !== currentTick
    ) {
      ctx.db.generator.id.update({
        ...generator,
        isConnected,
        effectiveOutput,
        lastNetworkSolveTick: currentTick,
      });
    }
  }

  const staleLines = lines.filter((line) => {
    const a = generatorById.get(line.aGeneratorId);
    const b = generatorById.get(line.bGeneratorId);
    return !a || !b;
  });
  for (const line of staleLines) {
    ctx.db.line.id.delete(line.id);
  }

  ctx.db.player.playerId.update({
    ...player,
    networkDirty: false,
  });
}

function maybeSolveNetworks(
  ctx: any,
  config: WorldConfigRow,
  currentTick: bigint,
): void {
  const players = (Array.from(ctx.db.player.iter()) as PlayerRow[]).sort(
    (a, b) => cmpString(a.playerId, b.playerId),
  );
  const isSafetyTick = currentTick % NETWORK_SOLVE_SAFETY_TICKS === 0n;
  for (const player of players) {
    if (!player.networkDirty && !isSafetyTick) {
      continue;
    }
    solvePlayerNetwork(ctx, config, currentTick, player.playerId);
  }
}

function processTick(ctx: any): void {
  const world = ensureWorldState(ctx);
  const config = ensureWorldConfig(ctx);
  runWaveLifecycle(ctx, world, config);

  const currentTick = world.currentTick;
  processCompletedRootRelocations(ctx, config, currentTick);
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

  maybeSolveNetworks(ctx, config, currentTick);

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

function requireJoined(ctx: any): {
  world: WorldStateRow;
  config: WorldConfigRow;
  playerId: string;
  player: PlayerRow;
} {
  const world = ensureWorldState(ctx);
  const config = ensureWorldConfig(ctx);
  const playerId = ctx.sender.toHexString();
  const player = ctx.db.player.playerId.find(playerId) as PlayerRow | null;
  if (!player) {
    throw new Error("player must call joinPlayer first");
  }
  return { world, config, playerId, player };
}

function requireControlledGenerator(
  ctx: any,
  generatorId: string,
  playerId: string,
): GeneratorRow {
  const generator = ctx.db.generator.id.find(
    generatorId,
  ) as GeneratorRow | null;
  if (!generator) {
    throw new Error(`generator not found: ${generatorId}`);
  }
  if (
    generator.ownerPlayerId !== playerId ||
    generator.state !== "controlled"
  ) {
    throw new Error(`generator must be controlled by player: ${generatorId}`);
  }
  return generator;
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
      rootGeneratorId: "",
      rootMoveAvailableAtTick: 0n,
      networkDirty: false,
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

export const placeRoot = spacetimedb.reducer(
  {
    generatorId: t.string(),
  },
  (ctx, { generatorId }) => {
    const { world, config, playerId, player } = requireJoined(ctx);
    if (player.rootGeneratorId !== "") {
      throw new Error("player already has root");
    }
    if (ctx.db.rootRelocation.playerId.find(playerId)) {
      throw new Error("root relocation already in progress");
    }

    const generator = ctx.db.generator.id.find(
      generatorId,
    ) as GeneratorRow | null;
    if (!generator) {
      throw new Error("generator not found");
    }
    if (generator.state !== "neutral" || generator.ownerPlayerId !== "") {
      throw new Error("root can only be placed on neutral generator");
    }

    setGeneratorControl(ctx, generator, playerId, "controlled");
    ctx.db.player.playerId.update({
      ...player,
      rootGeneratorId: generatorId,
      rootMoveAvailableAtTick:
        world.currentTick + rootMoveCooldownTicks(config),
      networkDirty: true,
    });
    const existingRoot = ctx.db.rootNode.playerId.find(
      playerId,
    ) as RootNodeRow | null;
    if (existingRoot) {
      ctx.db.rootNode.playerId.update({
        ...existingRoot,
        generatorId,
        placedAtTick: world.currentTick,
      });
    } else {
      ctx.db.rootNode.insert({
        playerId,
        generatorId,
        placedAtTick: world.currentTick,
      });
    }
  },
);

export const startMoveRoot = spacetimedb.reducer(
  {
    newGeneratorId: t.string(),
  },
  (ctx, { newGeneratorId }) => {
    const { world, config, playerId, player } = requireJoined(ctx);
    if (player.rootGeneratorId === "") {
      throw new Error("player has no root");
    }
    if (player.rootGeneratorId === newGeneratorId) {
      throw new Error("new root generator must differ from current root");
    }
    if (world.currentTick < player.rootMoveAvailableAtTick) {
      throw new Error("root move is on cooldown");
    }
    if (ctx.db.rootRelocation.playerId.find(playerId)) {
      throw new Error("root relocation already in progress");
    }

    const fromGenerator = ctx.db.generator.id.find(
      player.rootGeneratorId,
    ) as GeneratorRow | null;
    if (!fromGenerator) {
      throw new Error("current root generator not found");
    }

    const toGenerator = ctx.db.generator.id.find(
      newGeneratorId,
    ) as GeneratorRow | null;
    if (!toGenerator) {
      throw new Error("target generator not found");
    }
    if (toGenerator.state !== "neutral" || toGenerator.ownerPlayerId !== "") {
      throw new Error("target generator must be neutral");
    }

    setGeneratorControl(ctx, toGenerator, "", "isolated");
    ctx.db.player.playerId.update({
      ...player,
      networkDirty: true,
    });
    ctx.db.rootRelocation.insert({
      playerId,
      fromGeneratorId: player.rootGeneratorId,
      toGeneratorId: newGeneratorId,
      startTick: world.currentTick,
      finishTick: world.currentTick + rootMoveDurationTicks(config),
    });
  },
);

export const buildLine = spacetimedb.reducer(
  {
    aGeneratorId: t.string(),
    bGeneratorId: t.string(),
  },
  (ctx, { aGeneratorId, bGeneratorId }) => {
    const { world, playerId, player } = requireJoined(ctx);
    if (player.rootGeneratorId === "") {
      throw new Error("player must place root before building lines");
    }
    if (ctx.db.rootRelocation.playerId.find(playerId)) {
      throw new Error("cannot build line while root relocation is in progress");
    }
    if (aGeneratorId === bGeneratorId) {
      throw new Error("self-loop line is not allowed");
    }

    const a = requireControlledGenerator(ctx, aGeneratorId, playerId);
    const b = requireControlledGenerator(ctx, bGeneratorId, playerId);
    const lineId = makeLineId(playerId, a.id, b.id);
    if (ctx.db.line.id.find(lineId)) {
      throw new Error(`line already exists: ${lineId}`);
    }

    const controlledCount = countControlledGenerators(ctx, playerId);
    const maxLines = getMaxLines(controlledCount);
    const currentLines = countPlayerLines(ctx, playerId);
    if (currentLines >= maxLines) {
      throw new Error(`line limit reached: ${currentLines}/${maxLines}`);
    }

    const [aMin, bMax] = a.id <= b.id ? [a.id, b.id] : [b.id, a.id];
    const length = manhattanDistance({ x: a.x, y: a.y }, { x: b.x, y: b.y });
    ctx.db.line.insert({
      id: lineId,
      ownerPlayerId: playerId,
      aGeneratorId: aMin,
      bGeneratorId: bMax,
      length,
      capacity: DEFAULT_LINE_CAPACITY,
      load: 0,
      temp: 0,
      overheated: false,
      active: true,
      cooldownUntilTick: 0n,
      createdAtTick: world.currentTick,
    });

    ctx.db.player.playerId.update({
      ...player,
      networkDirty: true,
    });
  },
);

export const destroyLine = spacetimedb.reducer(
  {
    lineId: t.string(),
  },
  (ctx, { lineId }) => {
    const { playerId, player } = requireJoined(ctx);
    const line = ctx.db.line.id.find(lineId) as LineRow | null;
    if (!line) {
      throw new Error(`line not found: ${lineId}`);
    }
    if (line.ownerPlayerId !== playerId) {
      throw new Error("cannot destroy line owned by another player");
    }

    ctx.db.line.id.delete(lineId);
    ctx.db.player.playerId.update({
      ...player,
      networkDirty: true,
    });
  },
);

export const updateWorldConfig = spacetimedb.reducer(
  {
    ticksPerDay: t.u32(),
    ticksPerMinute: t.u32(),
    waveEveryDays: t.u32(),
    markerLeadDays: t.u32(),
    generatorLifeDays: t.u32(),
    waveSize: t.u32(),
  },
  (
    ctx,
    {
      ticksPerDay,
      ticksPerMinute,
      waveEveryDays,
      markerLeadDays,
      generatorLifeDays,
      waveSize,
    },
  ) => {
    const current = ensureWorldConfig(ctx);
    const next: WorldConfigRow = {
      ...current,
      ticksPerDay,
      ticksPerMinute,
      waveEveryDays,
      markerLeadDays,
      generatorLifeDays,
      waveSize,
    };
    waveTimingFromConfig(next);
    ctx.db.worldConfig.id.update(next);
  },
);

export const setTestAdminMode = spacetimedb.reducer(
  {
    enabled: t.bool(),
  },
  (ctx, { enabled }) => {
    const current = ensureWorldConfig(ctx);
    ctx.db.worldConfig.id.update({
      ...current,
      enableTestAdmin: enabled,
    });
  },
);

export const adminClaimGenerator = spacetimedb.reducer(
  {
    generatorId: t.string(),
  },
  (ctx, { generatorId }) => {
    const config = ensureWorldConfig(ctx);
    const playerId = ctx.sender.toHexString();
    if (!config.enableTestAdmin) {
      throw new Error("adminClaimGenerator is disabled");
    }
    const player = ctx.db.player.playerId.find(playerId) as PlayerRow | null;
    if (!player) {
      throw new Error("player must call joinPlayer first");
    }

    const generator = ctx.db.generator.id.find(
      generatorId,
    ) as GeneratorRow | null;
    if (!generator) {
      throw new Error("generator not found");
    }
    if (generator.ownerPlayerId !== "" || generator.state !== "neutral") {
      throw new Error("generator must be neutral to claim");
    }

    setGeneratorControl(ctx, generator, playerId, "controlled");
    ctx.db.player.playerId.update({
      ...player,
      networkDirty: true,
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
    processTick(ctx);
  },
));
