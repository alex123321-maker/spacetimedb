export class PRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
    if (this.state === 0) {
      this.state = 0x9e3779b9;
    }
  }

  nextU32(): number {
    let x = this.state >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }

  nextFloat01(): number {
    return this.nextU32() / 0x100000000;
  }

  rangeInt(minIncl: number, maxIncl: number): number {
    if (!Number.isInteger(minIncl) || !Number.isInteger(maxIncl)) {
      throw new Error("rangeInt bounds must be integers");
    }
    if (minIncl > maxIncl) {
      throw new Error("rangeInt invalid bounds: minIncl > maxIncl");
    }
    const span = (maxIncl - minIncl + 1) >>> 0;
    if (span === 0) {
      throw new Error("rangeInt span must be <= 2^32");
    }

    const threshold = (0x100000000 - span) % span;
    while (true) {
      const r = this.nextU32();
      if (r >= threshold) {
        return minIncl + (r % span);
      }
    }
  }
}
