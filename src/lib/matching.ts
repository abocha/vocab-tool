import { createHash } from "./id";
import type { Level, MatchingPair } from "../types";

export const MATCHING_MIN_SET_SIZE = 2;
export const MATCHING_MAX_SET_SIZE = 12;
export const DEFAULT_MATCHING_SET_SIZE = 6;

function hashToNumber(seed: string): number {
  const hex = createHash(seed);
  return Number.parseInt(hex.slice(0, 8), 16);
}

function buildOrder(length: number, seed: string): number[] {
  return Array.from({ length }, (_, index) => index).sort((a, b) => {
    const hashA = hashToNumber(`${seed}:${a}`);
    const hashB = hashToNumber(`${seed}:${b}`);
    return hashA - hashB;
  });
}

export function clampSetSize(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MATCHING_SET_SIZE;
  }
  const rounded = Math.round(value);
  if (rounded < MATCHING_MIN_SET_SIZE) return MATCHING_MIN_SET_SIZE;
  if (rounded > MATCHING_MAX_SET_SIZE) return MATCHING_MAX_SET_SIZE;
  return rounded;
}

export function seededShuffle<T>(values: T[], seed: string): T[] {
  if (values.length <= 1) {
    return [...values];
  }
  const order = buildOrder(values.length, seed);
  return order.map((index) => values[index]);
}

function normalizeRight(value: string): string {
  return value.trim().toLowerCase();
}

export function groupPairsIntoSets(
  pairs: MatchingPair[],
  setSize: number,
  seed: string,
): MatchingPair[][] {
  const targetSize = clampSetSize(setSize);
  if (pairs.length === 0) {
    return [];
  }
  const shuffled = seededShuffle(pairs, seed);
  const queue: MatchingPair[] = [...shuffled];
  const sets: MatchingPair[][] = [];
  let current: MatchingPair[] = [];
  let rights = new Set<string>();
  const spillover: MatchingPair[] = [];

  while (queue.length > 0) {
    const pair = queue.shift();
    if (!pair) {
      break;
    }
    const rightKey = normalizeRight(pair.right);
    if (current.length < targetSize && !rights.has(rightKey)) {
      current.push(pair);
      rights.add(rightKey);
    } else {
      spillover.push(pair);
    }

    if (current.length >= targetSize || queue.length === 0) {
      if (current.length > 0) {
        sets.push(current);
      }
      if (spillover.length > 0) {
        queue.unshift(...spillover);
        spillover.length = 0;
      }
      current = [];
      rights = new Set();
    }
  }

  return sets;
}

export function deriveMatchingSeed(options: {
  level: Level;
  fileName: string;
  pairCount: number;
  fingerprint?: string | null;
}): string {
  const parts = ["matching", options.fileName, options.level, String(options.pairCount)];
  if (options.fingerprint) {
    parts.push(options.fingerprint);
  }
  return parts.join("|");
}
