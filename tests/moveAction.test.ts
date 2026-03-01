import { describe, expect, test } from "vitest";
import { createServer } from "../reference_sim/server/index";
import { fx } from "../shared/fixed";

describe("move actions", () => {
  test("applies Move through pending queue on target tick", () => {
    const server = createServer();
    const player = server.joinPlayer({ sessionId: "s1" });

    server.enqueueAction("s1", {
      type: "Move",
      tick: 1,
      seq: 1,
      payload: { dx: 1, dy: 0 }
    });

    server.tick();
    expect(server.world.players.get(player.playerId)?.posX).toBe(fx(0));

    server.tick();
    const updated = server.world.players.get(player.playerId);
    expect(updated?.posX).toBe(fx(1));
    expect(updated?.posY).toBe(fx(0));
    expect(updated?.lastProcessedTick).toBe(1);
  });

  test("validates seq and tick in enqueueAction", () => {
    const server = createServer();
    server.joinPlayer({ sessionId: "s1" });

    server.enqueueAction("s1", {
      type: "Move",
      tick: 0,
      seq: 1,
      payload: { dx: 1, dy: 0 }
    });

    expect(() =>
      server.enqueueAction("s1", {
        type: "Move",
        tick: 0,
        seq: 1,
        payload: { dx: 0, dy: 1 }
      })
    ).toThrow(/seq/i);

    server.tick();

    expect(() =>
      server.enqueueAction("s1", {
        type: "Move",
        tick: 0,
        seq: 2,
        payload: { dx: 0, dy: 1 }
      })
    ).toThrow(/tick/i);
  });
});
