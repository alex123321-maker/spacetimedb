export type Fixed = number;

export const SCALE = 1000;

const maybeProcess = globalThis as unknown as {
  process?: { env?: { NODE_ENV?: string } };
};
const IS_DEV = maybeProcess.process?.env?.NODE_ENV !== "production";

export function assertInt(x: number, name = "value"): void {
  if (!IS_DEV) return;
  if (!Number.isInteger(x)) {
    throw new Error(`${name} must be an integer, got: ${x}`);
  }
}

export function assertSafeRange(x: number, name = "value"): void {
  if (!Number.isSafeInteger(x)) {
    throw new Error(`${name} exceeds Number.MAX_SAFE_INTEGER: ${x}`);
  }
}

export function fx(n: number): Fixed {
  const out = Math.floor(n * SCALE);
  assertInt(out, "fx");
  assertSafeRange(out, "fx");
  return out;
}

export function toFloat(a: Fixed): number {
  assertInt(a, "toFloat(input)");
  return a / SCALE;
}

export function add(a: Fixed, b: Fixed): Fixed {
  assertInt(a, "add(a)");
  assertInt(b, "add(b)");
  const out = a + b;
  assertInt(out, "add(result)");
  assertSafeRange(out, "add(result)");
  return out;
}

export function sub(a: Fixed, b: Fixed): Fixed {
  assertInt(a, "sub(a)");
  assertInt(b, "sub(b)");
  const out = a - b;
  assertInt(out, "sub(result)");
  assertSafeRange(out, "sub(result)");
  return out;
}

export function mulFixed(a: Fixed, b: Fixed): Fixed {
  assertInt(a, "mulFixed(a)");
  assertInt(b, "mulFixed(b)");
  const product = a * b;
  assertInt(product, "mulFixed(product)");
  assertSafeRange(product, "mulFixed(product)");
  const out = Math.floor(product / SCALE);
  assertInt(out, "mulFixed(result)");
  assertSafeRange(out, "mulFixed(result)");
  return out;
}

export function divFixed(a: Fixed, b: Fixed): Fixed {
  assertInt(a, "divFixed(a)");
  assertInt(b, "divFixed(b)");
  if (b === 0) {
    throw new Error("divFixed division by zero");
  }
  const numerator = a * SCALE;
  assertInt(numerator, "divFixed(numerator)");
  assertSafeRange(numerator, "divFixed(numerator)");
  const out = Math.floor(numerator / b);
  assertInt(out, "divFixed(result)");
  assertSafeRange(out, "divFixed(result)");
  return out;
}

export function clamp(a: Fixed, min: Fixed, max: Fixed): Fixed {
  assertInt(a, "clamp(a)");
  assertInt(min, "clamp(min)");
  assertInt(max, "clamp(max)");
  if (min > max) {
    throw new Error("clamp invalid range: min > max");
  }
  if (a < min) return min;
  if (a > max) return max;
  return a;
}

export function dist2(ax: Fixed, ay: Fixed, bx: Fixed, by: Fixed): number {
  assertInt(ax, "dist2(ax)");
  assertInt(ay, "dist2(ay)");
  assertInt(bx, "dist2(bx)");
  assertInt(by, "dist2(by)");
  const dx = ax - bx;
  const dy = ay - by;
  const dx2 = dx * dx;
  const dy2 = dy * dy;
  assertInt(dx2, "dist2(dx2)");
  assertInt(dy2, "dist2(dy2)");
  assertSafeRange(dx2, "dist2(dx2)");
  assertSafeRange(dy2, "dist2(dy2)");
  const out = dx2 + dy2;
  assertInt(out, "dist2(result)");
  assertSafeRange(out, "dist2(result)");
  return out;
}
