import { describe, expect, test } from "vitest";
import {
  SCALE,
  dist2,
  divFixed,
  fx,
  mulFixed,
  toFloat
} from "../shared/fixed";

describe("fixed math", () => {
  test("SCALE is 1000", () => {
    expect(SCALE).toBe(1000);
  });

  test("mulFixed floors deterministically", () => {
    expect(mulFixed(fx(1.5), fx(2.25))).toBe(3375);
    expect(toFloat(mulFixed(fx(1.5), fx(2.25)))).toBe(3.375);
    expect(mulFixed(fx(-1.5), fx(2.25))).toBe(-3375);
  });

  test("divFixed floors deterministically", () => {
    expect(divFixed(fx(5), fx(2))).toBe(2500);
    expect(divFixed(fx(1), fx(3))).toBe(333);
    expect(divFixed(fx(-1), fx(3))).toBe(-334);
  });

  test("dist2 uses integer squared distance", () => {
    expect(dist2(fx(0), fx(0), fx(3), fx(4))).toBe(25000000);
    expect(dist2(fx(-2), fx(1), fx(1), fx(-3))).toBe(25000000);
  });
});
