export const LEVELS = ["A1", "A2", "B1", "B2"] as const;
export type Level = (typeof LEVELS)[number];

export const EXERCISE_TYPES = ["gapfill", "matching", "mcq", "scramble"] as const;
export type ExerciseType = (typeof EXERCISE_TYPES)[number];

export interface ExerciseBase {
  id: string;
  type: ExerciseType;
  source?: string;
  license?: string;
  level?: Level;
}

export interface GapFillItem extends ExerciseBase {
  type: "gapfill";
  prompt: string;
  answer: string;
}

export interface MatchingPair {
  level?: Level | string;
  left: string;
  right: string;
  source?: string;
  license?: string;
}

export interface MatchingItem extends ExerciseBase {
  type: "matching";
  pairs: MatchingPair[];
  seed?: string;
  setId?: string;
}

export interface McqItem extends ExerciseBase {
  type: "mcq";
  prompt: string;
  options: string[];
  answer: string;
}

export interface ScrambleItem extends ExerciseBase {
  type: "scramble";
  prompt: string;
  answer: string;
}

export type ExerciseItem = GapFillItem | MatchingItem | McqItem | ScrambleItem;

export interface AppSettings {
  level: Level;
  exerciseType: ExerciseType;
  shuffle: boolean;
  maxItems: number | "all";
}

export interface ProgressEntry {
  correct: boolean;
  seenAt: string;
}

export type ProgressMap = Record<string, ProgressEntry>;

export interface InspectorFilters {
  contains: string;
  minLength: number | null;
  maxLength: number | null;
}

export interface InspectorStateSnapshot {
  filters: InspectorFilters;
  hiddenIds: string[];
  isOpen: boolean;
  showDetails: boolean;
  showInfo: boolean;
}
