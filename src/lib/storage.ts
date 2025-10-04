import type {
  AppSettings,
  ExerciseType,
  InspectorFilters,
  InspectorStateSnapshot,
  Level,
  ProgressEntry,
  ProgressMap,
} from "../types";
import { MAX_REGEX_PATTERN_LENGTH } from "./inspector";

const STORAGE_PREFIX = "esl-vocab-mvp";
const SETTINGS_KEY = `${STORAGE_PREFIX}/settings`;
const PROGRESS_KEY = `${STORAGE_PREFIX}/progress`;
const INSPECTOR_KEY = `${STORAGE_PREFIX}/inspector`;
const MATCHING_SET_KEY = "matching.setSize";

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

  return normalized;
}

type InspectorStateMap = Record<string, InspectorStateSnapshot>;

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
  };
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
      return {
        filters: sanitizeFilters(legacy.filters ?? getDefaultInspectorFilters()),
        hiddenIds: Array.isArray(legacy.hiddenIds)
          ? legacy.hiddenIds.filter((id): id is string => typeof id === "string")
          : [],
        isOpen: typeof legacy.isOpen === "boolean" ? legacy.isOpen : true,
        showDetails:
          typeof (legacy as Partial<InspectorStateSnapshot>).showDetails === "boolean"
            ? Boolean((legacy as Partial<InspectorStateSnapshot>).showDetails)
            : false,
        showInfo:
          typeof (legacy as Partial<InspectorStateSnapshot>).showInfo === "boolean"
            ? Boolean((legacy as Partial<InspectorStateSnapshot>).showInfo)
            : false,
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

  return {
    filters,
    hiddenIds,
    isOpen,
    showDetails,
    showInfo,
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
  };

  writeInspectorStateMap(map);
}
