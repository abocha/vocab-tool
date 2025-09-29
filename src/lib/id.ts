import type { ExerciseType } from "../types";

const HASH_SEED = 0x811c9dc5;

function hashString(value: string): string {
  let hash = HASH_SEED;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
    hash >>>= 0;
  }
  return hash.toString(16);
}

export function createItemId(type: ExerciseType, unique: string): string {
  return `${type}-${hashString(unique)}`;
}
