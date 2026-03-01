export type Comparator<T> = (a: T, b: T) => number;

export function cmpU32(a: number, b: number): number {
  const ua = a >>> 0;
  const ub = b >>> 0;
  if (ua < ub) return -1;
  if (ua > ub) return 1;
  return 0;
}

export function cmpId(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") {
    if (!Number.isInteger(a) || !Number.isInteger(b)) {
      throw new Error("cmpId expects integer numeric ids");
    }
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }
  const as = String(a);
  const bs = String(b);
  if (as < bs) return -1;
  if (as > bs) return 1;
  return 0;
}

export function cmpBy<T>(...comparators: Comparator<T>[]): Comparator<T> {
  return (a: T, b: T): number => {
    for (const cmp of comparators) {
      const out = cmp(a, b);
      if (out !== 0) return out;
    }
    return 0;
  };
}

export function stableSort<T>(arr: T[], cmp: Comparator<T>): T[] {
  return arr
    .map((value, index) => ({ value, index }))
    .sort((a, b) => {
      const primary = cmp(a.value, b.value);
      if (primary !== 0) return primary;
      return a.index - b.index;
    })
    .map((entry) => entry.value);
}

export interface OrderedAction {
  tick: number;
  playerId: string | number;
  seq: number;
}

export function orderKey(
  action: OrderedAction
): [number, string | number, number] {
  return [action.tick, action.playerId, action.seq];
}
