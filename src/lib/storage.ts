import type {
  AppSettings,
  ExerciseType,
  GapFillInspectorControls,
  InspectorFilters,
  InspectorPreset,
  InspectorStateSnapshot,
  Level,
  ProgressEntry,
  ProgressMap,
} from "../types";
import { MAX_REGEX_PATTERN_LENGTH } from "./inspector";
import { DEFAULT_MATCHING_SET_SIZE, clampSetSize } from "./matching";

const STORAGE_PREFIX = "esl-vocab-mvp";
const SETTINGS_KEY = `${STORAGE_PREFIX}/settings`;
const PROGRESS_KEY = `${STORAGE_PREFIX}/progress`;
const INSPECTOR_KEY = `${STORAGE_PREFIX}/inspector`;
const MATCHING_SET_KEY = "matching.setSize";
const PRESETS_KEY = `${STORAGE_PREFIX}/inspector-presets`;

const DEFAULT_SETTINGS: AppSettings = {
  level: "A2",
  exerciseType: "gapfill",
  shuffle: false,
  maxItems: 20,
};

const DEFAULT_INSPECTOR_FILTERS: InspectorFilters = {
  contains: "",
  minLength: null,
  maxLength: null,
  regex: "",
  bankQuality: "all",
  relaxedOnly: false,
};

const DEFAULT_GAP_FILL_CONTROLS: GapFillInspectorControls = {
  mode: "target",
  bankSize: 6,
  hints: {
    initialLetter: false,
    pos: false,
    collocationCue: false,
    tts: false,
  },
  difficulty: "A2",
  maxBlanksPerSentence: 1,
};

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadSettings(): AppSettings {
  if (!isBrowser()) {
    return DEFAULT_SETTINGS;
  }

  try {
    const stored = window.localStorage.getItem(SETTINGS_KEY);
    if (!stored) {
      return DEFAULT_SETTINGS;
    }
    const parsed = JSON.parse(stored);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
    } as AppSettings;
  } catch (error) {
    console.warn("Failed to load settings", error);
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  if (!isBrowser()) {
    return;
  }

  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn("Failed to persist settings", error);
  }
}

export function loadMatchingSetSize(): number | null {
  if (!isBrowser()) {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(MATCHING_SET_KEY);
    if (!stored) {
      return null;
    }
    const parsed = Number.parseInt(stored, 10);
    if (Number.isNaN(parsed)) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn("Failed to load matching set size", error);
    return null;
  }
}

export function saveMatchingSetSize(value: number): void {
  if (!isBrowser()) {
    return;
  }

  try {
    window.localStorage.setItem(MATCHING_SET_KEY, String(value));
  } catch (error) {
    console.warn("Failed to persist matching set size", error);
  }
}

export function loadProgress(): ProgressMap {
  if (!isBrowser()) {
    return {};
  }

  try {
    const stored = window.localStorage.getItem(PROGRESS_KEY);
    if (!stored) {
      return {};
    }
    const parsed = JSON.parse(stored) as ProgressMap;
    return parsed ?? {};
  } catch (error) {
    console.warn("Failed to load progress", error);
    return {};
  }
}

export function saveProgress(progress: ProgressMap): void {
  if (!isBrowser()) {
    return;
  }

  try {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch (error) {
    console.warn("Failed to persist progress", error);
  }
}

export function recordProgress(
  progress: ProgressMap,
  itemId: string,
  result: ProgressEntry,
): ProgressMap {
  const next: ProgressMap = {
    ...progress,
    [itemId]: result,
  };
  saveProgress(next);
  return next;
}

export function resetProgress(): void {
  if (!isBrowser()) {
    return;
  }

  try {
    window.localStorage.removeItem(PROGRESS_KEY);
  } catch (error) {
    console.warn("Failed to clear progress", error);
  }
}

export function getDefaultSettings(): AppSettings {
  return { ...DEFAULT_SETTINGS };
}

function sanitizeFilters(filters: InspectorFilters): InspectorFilters {
  const normalized: InspectorFilters = {
    contains: typeof filters.contains === "string" ? filters.contains : "",
    minLength: null,
    maxLength: null,
    regex: typeof filters.regex === "string" ? filters.regex : "",
    bankQuality: "all",
    relaxedOnly: Boolean(filters.relaxedOnly),
  };

  if (normalized.regex.length > MAX_REGEX_PATTERN_LENGTH) {
    normalized.regex = normalized.regex.slice(0, MAX_REGEX_PATTERN_LENGTH);
  }

  if (typeof filters.minLength === "number" && Number.isFinite(filters.minLength) && filters.minLength >= 0) {
    normalized.minLength = filters.minLength;
  }

  if (typeof filters.maxLength === "number" && Number.isFinite(filters.maxLength) && filters.maxLength >= 0) {
    normalized.maxLength = filters.maxLength;
  }

  const bankQuality = filters.bankQuality;
  if (
    bankQuality === "solid" ||
    bankQuality === "soft" ||
    bankQuality === "needs_review" ||
    bankQuality === "all"
  ) {
    normalized.bankQuality = bankQuality;
  }

  return normalized;
}

type InspectorStateMap = Record<string, InspectorStateSnapshot>;
type InspectorPresetMap = Record<string, InspectorPreset[]>;

const GAP_FILL_BANK_MIN = 4;
const GAP_FILL_BANK_MAX = 8;
const GAP_FILL_ALLOWED_MODES = new Set(["target", "collocation", "grammar"]);
const GAP_FILL_ALLOWED_DIFFICULTIES = new Set(["A1", "A2", "B1"]);

function clampGapFillBankSize(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_GAP_FILL_CONTROLS.bankSize;
  }
  if (value < GAP_FILL_BANK_MIN) return GAP_FILL_BANK_MIN;
  if (value > GAP_FILL_BANK_MAX) return GAP_FILL_BANK_MAX;
  return Math.round(value);
}

function sanitizeGapFillControls(
  value: Partial<GapFillInspectorControls> | undefined,
): GapFillInspectorControls {
  const defaults = getDefaultGapFillControls();
  const mode = typeof value?.mode === "string" && GAP_FILL_ALLOWED_MODES.has(value.mode)
    ? (value.mode as GapFillInspectorControls["mode"])
    : defaults.mode;
  const bankSize = clampGapFillBankSize(value?.bankSize);
  const difficulty =
    typeof value?.difficulty === "string" && GAP_FILL_ALLOWED_DIFFICULTIES.has(value.difficulty)
      ? (value.difficulty as GapFillInspectorControls["difficulty"])
      : defaults.difficulty;
  const maxBlanks = value?.maxBlanksPerSentence === 2 ? 2 : 1;
  const hintsSource = (value?.hints ?? {}) as Partial<GapFillInspectorControls["hints"]>;
  const hints = {
    initialLetter: Boolean(hintsSource.initialLetter),
    pos: Boolean(hintsSource.pos),
    collocationCue: Boolean(hintsSource.collocationCue),
    tts: Boolean(hintsSource.tts),
  };

  return {
    mode,
    bankSize,
    hints,
    difficulty,
    maxBlanksPerSentence: maxBlanks,
  };
}

function createInspectorKey(level: Level, type: ExerciseType, fingerprint: string): string {
  return `${level}:${type}:${fingerprint}`;
}

function readInspectorStateMap(): InspectorStateMap {
  if (!isBrowser()) {
    return {};
  }

  try {
    const stored = window.localStorage.getItem(INSPECTOR_KEY);
    if (!stored) {
      return {};
    }
    const parsed = JSON.parse(stored) as InspectorStateMap;
    return parsed ?? {};
  } catch (error) {
    console.warn("Failed to read inspector state", error);
    return {};
  }
}

function writeInspectorStateMap(state: InspectorStateMap): void {
  if (!isBrowser()) {
    return;
  }

  try {
    window.localStorage.setItem(INSPECTOR_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Failed to persist inspector state", error);
  }
}

function createPresetKey(level: Level, type: ExerciseType): string {
  return `${level}:${type}`;
}

function readPresetMap(): InspectorPresetMap {
  if (!isBrowser()) {
    return {};
  }
  try {
    const stored = window.localStorage.getItem(PRESETS_KEY);
    if (!stored) {
      return {};
    }
    const parsed = JSON.parse(stored) as InspectorPresetMap;
    return parsed ?? {};
  } catch (error) {
    console.warn("Failed to read inspector presets", error);
    return {};
  }
}

function writePresetMap(map: InspectorPresetMap): void {
  if (!isBrowser()) {
    return;
  }
  try {
    window.localStorage.setItem(PRESETS_KEY, JSON.stringify(map));
  } catch (error) {
    console.warn("Failed to persist inspector presets", error);
  }
}

export function getDefaultInspectorFilters(): InspectorFilters {
  return { ...DEFAULT_INSPECTOR_FILTERS };
}

export function getDefaultInspectorState(): InspectorStateSnapshot {
  return {
    filters: getDefaultInspectorFilters(),
    hiddenIds: [],
    isOpen: true,
    showDetails: false,
    showInfo: false,
    gapFill: getDefaultGapFillControls(),
  };
}

export function getDefaultGapFillControls(): GapFillInspectorControls {
  return {
    mode: DEFAULT_GAP_FILL_CONTROLS.mode,
    bankSize: DEFAULT_GAP_FILL_CONTROLS.bankSize,
    hints: { ...DEFAULT_GAP_FILL_CONTROLS.hints },
    difficulty: DEFAULT_GAP_FILL_CONTROLS.difficulty,
    maxBlanksPerSentence: DEFAULT_GAP_FILL_CONTROLS.maxBlanksPerSentence,
  };
}

export function loadInspectorPresets(level: Level, type: ExerciseType): InspectorPreset[] {
  const map = readPresetMap();
  const key = createPresetKey(level, type);
  const stored = map[key];
  if (!stored || !Array.isArray(stored)) {
    return [];
  }
  return stored.map((entry) => ({
    ...entry,
    hiddenIds: Array.isArray(entry.hiddenIds)
      ? entry.hiddenIds.filter((id): id is string => typeof id === "string")
      : [],
    filters: sanitizeFilters(entry.filters ?? getDefaultInspectorFilters()),
    gapFill: sanitizeGapFillControls(entry.gapFill),
    settings: {
      ...DEFAULT_SETTINGS,
      ...(entry.settings as Partial<AppSettings>),
    },
    matchingSetSize: clampSetSize(Number(entry.matchingSetSize ?? DEFAULT_MATCHING_SET_SIZE)),
    matchingSeed: typeof entry.matchingSeed === "string" ? entry.matchingSeed : undefined,
  }));
}

export function saveInspectorPresets(
  level: Level,
  type: ExerciseType,
  presets: InspectorPreset[],
): void {
  const map = readPresetMap();
  const key = createPresetKey(level, type);
  map[key] = presets;
  writePresetMap(map);
}

export function loadInspectorState(
  level: Level,
  type: ExerciseType,
  fingerprint: string,
): InspectorStateSnapshot {
  const map = readInspectorStateMap();
  const key = createInspectorKey(level, type, fingerprint);
  const stored = map[key];

  if (!stored) {
    const legacy = map[`${level}:${type}`];
    if (legacy) {
      const partialLegacy = legacy as Partial<InspectorStateSnapshot>;
      return {
        filters: sanitizeFilters(legacy.filters ?? getDefaultInspectorFilters()),
        hiddenIds: Array.isArray(legacy.hiddenIds)
          ? legacy.hiddenIds.filter((id): id is string => typeof id === "string")
          : [],
        isOpen: typeof legacy.isOpen === "boolean" ? legacy.isOpen : true,
        showDetails:
          typeof partialLegacy.showDetails === "boolean" ? Boolean(partialLegacy.showDetails) : false,
        showInfo:
          typeof partialLegacy.showInfo === "boolean" ? Boolean(partialLegacy.showInfo) : false,
        gapFill: sanitizeGapFillControls(partialLegacy.gapFill),
      };
    }
    return getDefaultInspectorState();
  }

  const filters = stored.filters ? sanitizeFilters(stored.filters) : getDefaultInspectorFilters();
  const hiddenIds = Array.isArray(stored.hiddenIds)
    ? stored.hiddenIds.filter((id): id is string => typeof id === "string")
    : [];
  const isOpen = typeof stored.isOpen === "boolean" ? stored.isOpen : true;
  const showDetails = typeof stored.showDetails === "boolean" ? stored.showDetails : false;
  const showInfo = typeof stored.showInfo === "boolean" ? stored.showInfo : false;
  const gapFill = sanitizeGapFillControls(stored.gapFill);

  return {
    filters,
    hiddenIds,
    isOpen,
    showDetails,
    showInfo,
    gapFill,
  };
}

export function saveInspectorState(
  level: Level,
  type: ExerciseType,
  fingerprint: string,
  state: InspectorStateSnapshot,
): void {
  const map = readInspectorStateMap();
  const key = createInspectorKey(level, type, fingerprint);

  map[key] = {
    filters: sanitizeFilters(state.filters),
    hiddenIds: [...state.hiddenIds],
    isOpen: Boolean(state.isOpen),
    showDetails: Boolean(state.showDetails),
    showInfo: Boolean(state.showInfo),
    gapFill: sanitizeGapFillControls(state.gapFill),
  };

  writeInspectorStateMap(map);
}
