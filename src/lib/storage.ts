import type {
  AppSettings,
  ExerciseType,
  InspectorFilters,
  InspectorStateSnapshot,
  Level,
  ProgressEntry,
  ProgressMap,
} from "../types";

const STORAGE_PREFIX = "esl-vocab-mvp";
const SETTINGS_KEY = `${STORAGE_PREFIX}/settings`;
const PROGRESS_KEY = `${STORAGE_PREFIX}/progress`;
const INSPECTOR_KEY = `${STORAGE_PREFIX}/inspector`;

const DEFAULT_SETTINGS: AppSettings = {
  level: "A2",
  exerciseType: "gapfill",
  shuffle: false,
  maxItems: 20,
  matchingPairLimit: 0,
};

const DEFAULT_INSPECTOR_FILTERS: InspectorFilters = {
  contains: "",
  minLength: null,
  maxLength: null,
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
  };

  if (typeof filters.minLength === "number" && Number.isFinite(filters.minLength) && filters.minLength >= 0) {
    normalized.minLength = filters.minLength;
  }

  if (typeof filters.maxLength === "number" && Number.isFinite(filters.maxLength) && filters.maxLength >= 0) {
    normalized.maxLength = filters.maxLength;
  }

  return normalized;
}

type InspectorStateMap = Record<string, InspectorStateSnapshot>;

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
  };
}

export function loadInspectorState(level: Level, type: ExerciseType): InspectorStateSnapshot {
  const key = `${level}:${type}`;
  const map = readInspectorStateMap();
  const stored = map[key];

  if (!stored) {
    return getDefaultInspectorState();
  }

  const filters = stored.filters ? sanitizeFilters(stored.filters) : getDefaultInspectorFilters();
  const hiddenIds = Array.isArray(stored.hiddenIds)
    ? stored.hiddenIds.filter((id): id is string => typeof id === "string")
    : [];
  const isOpen = typeof stored.isOpen === "boolean" ? stored.isOpen : true;

  return {
    filters,
    hiddenIds,
    isOpen,
  };
}

export function saveInspectorState(
  level: Level,
  type: ExerciseType,
  state: InspectorStateSnapshot,
): void {
  const key = `${level}:${type}`;
  const map = readInspectorStateMap();

  map[key] = {
    filters: sanitizeFilters(state.filters),
    hiddenIds: [...state.hiddenIds],
    isOpen: Boolean(state.isOpen),
  };

  writeInspectorStateMap(map);
}
