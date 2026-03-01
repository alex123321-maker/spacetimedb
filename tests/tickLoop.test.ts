import { describe, expect, test, vi } from "vitest";
import { createServer } from "../server/index";

describe("tick loop", () => {
  test("currentTick increments on each Tick reducer call", () => {
    const server = createServer();

    expect(server.world.worldState.currentTick).toBe(0);
    server.tick();
    expect(server.world.worldState.currentTick).toBe(1);
    server.tick();
    expect(server.world.worldState.currentTick).toBe(2);
  });

  test("tick loop runs at 20 Hz (50ms interval)", async () => {
    vi.useFakeTimers();
    const server = createServer();

    server.start();
    await vi.advanceTimersByTimeAsync(150);
    server.stop();

    expect(server.world.worldState.currentTick).toBe(3);
    vi.useRealTimers();
  });

  test("applies pending actions in deterministic (tick, playerId, seq) order", () => {
    const server = createServer();
    const p1 = server.joinPlayer({ sessionId: "s1" });
    const p2 = server.joinPlayer({ sessionId: "s2" });

    const appliedOrder: string[] = [];
    const unsubscribe = server.subscribeWorld((event) => {
      if (event.type !== "action_applied") return;
      appliedOrder.push(`${event.action.playerId}:${event.action.seq}`);
    });

    server.enqueueAction("s2", {
      type: "Move",
      tick: 1,
      seq: 1,
      payload: { dx: 1, dy: 0 }
    });
    server.enqueueAction("s1", {
      type: "Move",
      tick: 1,
      seq: 1,
      payload: { dx: 1, dy: 0 }
    });
    server.enqueueAction("s2", {
      type: "Move",
      tick: 0,
      seq: 2,
      payload: { dx: 0, dy: 1 }
    });
    server.enqueueAction("s1", {
      type: "Move",
      tick: 0,
      seq: 2,
      payload: { dx: 0, dy: 1 }
    });

    server.tick();
    server.tick();
    unsubscribe();

    expect(appliedOrder).toEqual([
      `${p1.playerId}:2`,
      `${p2.playerId}:2`,
      `${p1.playerId}:1`,
      `${p2.playerId}:1`
    ]);
  });
});
