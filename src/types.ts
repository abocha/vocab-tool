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

export type GapMode = "target" | "collocation" | "grammar";

export type GapFillHints = Record<string, string>;
export type BankQuality = "solid" | "soft" | "needs_review";

export interface GapFillBankMeta {
  tags: string[];
  slot?: string;
  size?: number;
  usedRelax?: boolean;
}

export interface GapFillItem extends ExerciseBase {
  type: "gapfill";
  prompt: string;
  /**
   * Primary answer used for backward compatibility with legacy packs. When
   * multiple answers are provided via the `answers` column this reflects the
   * first entry to keep existing UI behaviour stable while the enhanced
   * experience is rolled out.
   */
  answer: string;
  /**
   * Optional multi-answer support sourced from the `answers` CSV column. When
   * present the learning components should accept any entry in this list as a
   * correct response.
   */
  answers?: string[];
  /**
   * Gap selection metadata recorded by the builders. Deterministic presets use
   * this to communicate whether the blank targets core lexis, collocations, or
   * grammar slots.
   */
  gapMode?: GapMode;
  /** Deterministic word bank options emitted by the builders. */
  bank?: string[];
  /** Optional hint metadata parsed from the `hints` column. */
  hints?: GapFillHints;
  bankQuality?: BankQuality;
  bankMeta?: GapFillBankMeta;
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

export type GapFillDifficulty = "A1" | "A2" | "B1";

export interface GapFillHintToggles {
  initialLetter: boolean;
  pos: boolean;
  collocationCue: boolean;
  tts: boolean;
}

export interface GapFillInspectorControls {
  mode: GapMode;
  bankSize: number;
  hints: GapFillHintToggles;
  difficulty: GapFillDifficulty;
  maxBlanksPerSentence: 1 | 2;
}

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
  regex: string;
  bankQuality: "all" | BankQuality;
  relaxedOnly: boolean;
}

export interface InspectorStateSnapshot {
  filters: InspectorFilters;
  hiddenIds: string[];
  isOpen: boolean;
  showDetails: boolean;
  showInfo: boolean;
  gapFill: GapFillInspectorControls;
}

export interface InspectorPreset {
  id: string;
  name: string;
  createdAt: string;
  filters: InspectorFilters;
  hiddenIds: string[];
  gapFill: GapFillInspectorControls;
  settings: AppSettings;
  matchingSetSize: number;
  matchingSeed?: string;
}
