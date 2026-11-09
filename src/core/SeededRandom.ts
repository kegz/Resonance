/** A small deterministic PRNG whose complete state fits in a snapshot. */
export class SeededRandom {
  private value: number;

  constructor(seed: string | number) {
    let hash = 2166136261;
    for (const character of String(seed)) {
      hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    }
    this.value = hash >>> 0;
  }

  get state(): number {
    return this.value;
  }

  set state(value: number) {
    this.value = value >>> 0;
  }

  next(): number {
    this.value = (this.value + 0x6d2b79f5) >>> 0;
    let value = this.value;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
}
