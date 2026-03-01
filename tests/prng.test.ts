import { describe, expect, test } from "vitest";
import { PRNG } from "../shared/prng";

describe("PRNG xorshift32", () => {
  test("fixed seed returns fixed nextU32 vector", () => {
    const prng = new PRNG(123456789);
    const values = Array.from({ length: 10 }, () => prng.nextU32());

    expect(values).toEqual([
      2714967881, 2238813396, 1250077441, 3820100336, 3177519686, 3684138832,
      3151087790, 3662508108, 4242376622, 3374601978
    ]);
  });

  test("rangeInt returns inclusive integer bounds", () => {
    const prng = new PRNG(42);
    for (let i = 0; i < 100; i += 1) {
      const v = prng.rangeInt(-3, 7);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThanOrEqual(7);
    }
  });
});
