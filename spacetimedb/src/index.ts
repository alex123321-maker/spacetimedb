import { ScheduleAt } from "spacetimedb";
import { schema, table, t } from "spacetimedb/server";

const WORLD_STATE_ID = "singleton";
const TICK_SCHEDULER_ID = 1n;
const TICK_RATE = 20;
const TICK_INTERVAL_MICROS = 50_000n;
const ACTION_BUDGET_PER_TICK = 5;
const FIXED_SCALE = 1000n;
const SEED = 12345;
let scheduledTickRef: any;

interface WorldStateRow {
  id: string;
  currentTick: bigint;
  tickRate: number;
  seed: number;
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

const worldStateTable = table(
  { public: true },
  {
    id: t.string().primaryKey(),
    currentTick: t.u64(),
    tickRate: t.u16(),
    seed: t.u32(),
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
  player: playerTable,
  playerSession: playerSessionTable,
  pendingAction: pendingActionTable,
  obstacle: obstacleTable,
  tickSchedule: tickScheduleTable,
});

export default spacetimedb;

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

const SEEDED_OBSTACLES: readonly ObstacleRow[] = [
  { id: "1:-2", x: 1, y: -2 },
  { id: "1:-1", x: 1, y: -1 },
  { id: "1:0", x: 1, y: 0 },
  { id: "1:1", x: 1, y: 1 },
  { id: "1:2", x: 1, y: 2 },
];

function obstacleId(x: bigint, y: bigint): string {
  return `${x.toString()}:${y.toString()}`;
}

function ensureObstacles(ctx: any): void {
  for (const obstacle of SEEDED_OBSTACLES) {
    if (ctx.db.obstacle.id.find(obstacle.id)) {
      continue;
    }
    ctx.db.obstacle.insert(obstacle);
  }
}

function isBlockedCell(ctx: any, cellX: bigint, cellY: bigint): boolean {
  return Boolean(ctx.db.obstacle.id.find(obstacleId(cellX, cellY)));
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

  if (isBlockedCell(ctx, nextCellX, nextCellY)) {
    return;
  }

  const next = {
    ...player,
    posX: player.posX + BigInt(dx) * FIXED_SCALE,
    posY: player.posY + BigInt(dy) * FIXED_SCALE,
    lastProcessedTick: currentTick,
  };
  ctx.db.player.playerId.update(next);
}

function processTick(ctx: any): void {
  const world = ensureWorldState(ctx);
  const currentTick = world.currentTick;

  const due = (
    Array.from(ctx.db.pendingAction.iter()) as PendingActionRow[]
  ).filter((action) => action.tick <= currentTick);

  due.sort((a, b) => {
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
  for (const session of ctx.db.playerSession.iter() as Iterable<PlayerSessionRow>) {
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
  ensureObstacles(ctx);
  ensureTickSchedule(ctx);
});

export const onConnect = spacetimedb.clientConnected((ctx) => {
  ensureWorldState(ctx);
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
