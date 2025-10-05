import { createHash } from "./id";

function hashToNumber(seed: string): number {
  const hex = createHash(seed);
  return Number.parseInt(hex.slice(0, 8), 16);
}

function getDeterministicOrder(length: number, seed: string): number[] {
  return Array.from({ length }, (_, index) => index).sort((a, b) => {
    const hashA = hashToNumber(`${seed}:${a}`);
    const hashB = hashToNumber(`${seed}:${b}`);
    return hashA - hashB;
  });
}

export function deterministicShuffle<T>(values: readonly T[], seed: string): T[] {
  if (values.length <= 1) {
    return Array.from(values);
  }
  const order = getDeterministicOrder(values.length, seed);
  return order.map((index) => values[index]);
}
