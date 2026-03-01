import { describe, expect, test } from "vitest";
import { createServer } from "../reference_sim/server/index";
import { fx } from "../shared/fixed";
import { ACTION_BUDGET_PER_TICK } from "../reference_sim/server/tables/playerSession";

describe("joinPlayer reducer", () => {
  test("creates Player + PlayerSession for new session", () => {
    const server = createServer();
    const player = server.joinPlayer({ sessionId: "session-a" });

    const storedPlayer = server.world.players.get(player.playerId);
    const storedSession = server.world.playerSessions.get("session-a");

    expect(storedPlayer).toBeDefined();
    expect(storedPlayer?.posX).toBe(fx(0));
    expect(storedPlayer?.posY).toBe(fx(0));
    expect(storedPlayer?.lastProcessedTick).toBe(-1);

    expect(storedSession).toBeDefined();
    expect(storedSession?.playerId).toBe(player.playerId);
    expect(storedSession?.lastSeq).toBe(0);
    expect(storedSession?.actionBudget).toBe(ACTION_BUDGET_PER_TICK);
  });

  test("rejoin with same session returns same player", () => {
    const server = createServer();
    const first = server.joinPlayer({ sessionId: "session-a" });
    const second = server.joinPlayer({ sessionId: "session-a" });

    expect(second.playerId).toBe(first.playerId);
    expect(server.world.players.size).toBe(1);
    expect(server.world.playerSessions.size).toBe(1);
  });
});
