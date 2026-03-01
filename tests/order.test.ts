import { describe, expect, test } from "vitest";
import {
  cmpBy,
  cmpId,
  cmpU32,
  orderKey,
  stableSort,
  type OrderedAction
} from "../shared/determinism";

interface PendingAction extends OrderedAction {
  id: number;
}

describe("deterministic action ordering", () => {
  const cmpPending = cmpBy<PendingAction>(
    (a, b) => cmpU32(a.tick, b.tick),
    (a, b) => cmpId(a.playerId, b.playerId),
    (a, b) => cmpU32(a.seq, b.seq),
    (a, b) => cmpId(a.id, b.id)
  );

  test("sorts PendingAction by (tick, playerId, seq, id)", () => {
    const shuffled: PendingAction[] = [
      { id: 50, tick: 9, playerId: 2, seq: 3 },
      { id: 20, tick: 8, playerId: 7, seq: 3 },
      { id: 40, tick: 8, playerId: 7, seq: 2 },
      { id: 10, tick: 8, playerId: 3, seq: 10 },
      { id: 30, tick: 8, playerId: 7, seq: 2 }
    ];

    const ordered = stableSort(shuffled, cmpPending);

    expect(ordered.map((a) => a.id)).toEqual([10, 30, 40, 20, 50]);
  });

  test("orderKey shape is [tick, playerId, seq]", () => {
    const action: PendingAction = { id: 1, tick: 11, playerId: 42, seq: 7 };
    expect(orderKey(action)).toEqual([11, 42, 7]);
  });
});
