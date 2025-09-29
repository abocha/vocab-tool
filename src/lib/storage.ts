import type { AppSettings, ProgressEntry, ProgressMap } from "../types";

const STORAGE_PREFIX = "esl-vocab-mvp";
const SETTINGS_KEY = `${STORAGE_PREFIX}/settings`;
const PROGRESS_KEY = `${STORAGE_PREFIX}/progress`;

const DEFAULT_SETTINGS: AppSettings = {
  level: "A2",
  exerciseType: "gapfill",
  shuffle: false,
  maxItems: 20,
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
