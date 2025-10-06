import type {
  ExerciseType,
  InspectorFilters,
  Level,
  LibraryPresetDefinition,
  LibraryPresetManifest,
  PresetSeedStrategy,
} from "../types";
import { LEVELS } from "../types";
import manifest from "../../presets/library.json" assert { type: "json" };

export interface PresetSummary {
  id: string;
  label: string;
  description?: string;
  tags: string[];
  exerciseTypes: ExerciseType[];
  levels: Level[];
}

const LEVEL_SET = new Set<Level>(LEVELS);

function isLevel(value: unknown): value is Level {
  return typeof value === "string" && LEVEL_SET.has(value as Level);
}

function assertManifest(data: unknown): LibraryPresetManifest {
  if (!data || typeof data !== "object") {
    throw new Error("Preset library JSON is malformed (expected object).");
  }
  const record = data as Record<string, unknown>;
  const version = Number(record.libraryVersion);
  if (!Number.isFinite(version)) {
    throw new Error("Preset library missing numeric libraryVersion.");
  }
  const presets = Array.isArray(record.presets) ? (record.presets as unknown[]) : [];
  if (presets.length === 0) {
    throw new Error("Preset library contains no presets.");
  }
  const parsed: LibraryPresetDefinition[] = presets.map((entry) => sanitizePreset(entry));
  const seen = new Set<string>();
  parsed.forEach((preset) => {
    if (seen.has(preset.id)) {
      throw new Error(`Duplicate preset id detected: ${preset.id}`);
    }
    seen.add(preset.id);
  });
  return {
    libraryVersion: version,
    updated: typeof record.updated === "string" ? record.updated : undefined,
    presets: parsed,
  };
}

function sanitizePreset(entry: unknown): LibraryPresetDefinition {
  if (!entry || typeof entry !== "object") {
    throw new Error("Preset entry must be an object.");
  }
  const record = entry as Record<string, unknown>;
  const id = String(record.id ?? "").trim();
  if (!id) {
    throw new Error("Preset entry missing id.");
  }
  const label = String(record.label ?? "").trim();
  if (!label) {
    throw new Error(`Preset ${id} missing label.`);
  }
  const version = Number(record.version ?? NaN);
  if (!Number.isFinite(version) || version < 1) {
    throw new Error(`Preset ${id} has invalid version.`);
  }
  const exerciseTypes = Array.isArray(record.exerciseTypes)
    ? (record.exerciseTypes as ExerciseType[])
    : [];
  if (exerciseTypes.length === 0) {
    throw new Error(`Preset ${id} must specify exerciseTypes.`);
  }
  const levelValues = Array.isArray(record.levels) ? record.levels : [];
  const levels = levelValues.filter(isLevel);
  if (levels.length === 0) {
    throw new Error(`Preset ${id} must specify levels.`);
  }
  if (levels.length !== levelValues.length) {
    const invalid = levelValues.filter((value) => !isLevel(value)).map((value) => String(value));
    throw new Error(`Preset ${id} has invalid levels: ${invalid.join(", ") || "<unknown>"}`);
  }
  const tags = Array.isArray(record.tags) ? (record.tags as string[]).map((tag) => String(tag)) : [];
  const description = typeof record.description === "string" ? record.description : undefined;
  return {
    id,
    label,
    description,
    version,
    tags,
    exerciseTypes: exerciseTypes as ExerciseType[],
    levels,
    filters: sanitizeFilters(record.filters),
    gapFill: sanitizeNested(record.gapFill),
    matching: sanitizeMatching(record.matching),
    settings: sanitizeSettings(record.settings),
    builder: sanitizeBuilder(record.builder),
  };
}

function sanitizeFilters(value: unknown): Partial<InspectorFilters> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const result: Partial<InspectorFilters> = {};
  if (typeof source.contains === "string") result.contains = source.contains;
  if (typeof source.regex === "string") result.regex = source.regex;
  if (typeof source.minLength === "number") result.minLength = source.minLength;
  if (typeof source.maxLength === "number") result.maxLength = source.maxLength;
  if (typeof source.bankQuality === "string") {
    result.bankQuality = source.bankQuality as InspectorFilters["bankQuality"];
  }
  if (typeof source.relaxedOnly === "boolean") result.relaxedOnly = source.relaxedOnly;
  return result;
}

function sanitizeNested<T>(value: unknown): T | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as T;
}

function sanitizeMatching(value: unknown): LibraryPresetDefinition["matching"] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const result: LibraryPresetDefinition["matching"] = {};
  if (typeof record.setSize === "number") result.setSize = record.setSize;
  if (record.seedStrategy) result.seedStrategy = sanitizeSeedStrategy(record.seedStrategy);
  return result;
}

function sanitizeSettings(value: unknown): LibraryPresetDefinition["settings"] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const result: LibraryPresetDefinition["settings"] = {};
  if (typeof record.shuffle === "boolean") result.shuffle = record.shuffle;
  if (typeof record.maxItems === "number" || record.maxItems === "all") {
    result.maxItems = record.maxItems as number | "all";
  }
  if (record.seedStrategy) result.seedStrategy = sanitizeSeedStrategy(record.seedStrategy);
  return result;
}

function sanitizeSeedStrategy(value: unknown): PresetSeedStrategy {
  if (value === "preserve" || value === "regen") {
    return value;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.type === "fixed" && typeof record.seed === "string") {
      return { type: "fixed", seed: record.seed };
    }
  }
  throw new Error("Invalid seedStrategy in preset definition.");
}

function sanitizeBuilder(value: unknown): LibraryPresetDefinition["builder"] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as LibraryPresetDefinition["builder"];
}

const parsedManifest = assertManifest(manifest);
const presetMap = new Map<string, LibraryPresetDefinition>();
parsedManifest.presets.forEach((preset) => {
  presetMap.set(preset.id, preset);
});

export function getPresetLibraryVersion(): number {
  return parsedManifest.libraryVersion;
}

export function listLibraryPresets(params?: {
  level?: Level;
  exerciseType?: ExerciseType;
  tags?: string[];
}): PresetSummary[] {
  const { level, exerciseType, tags } = params ?? {};
  return parsedManifest.presets
    .filter((preset) => {
      if (level && !preset.levels.includes(level)) {
        return false;
      }
      if (exerciseType && !preset.exerciseTypes.includes(exerciseType)) {
        return false;
      }
      if (tags && tags.length > 0) {
        return tags.every((tag) => preset.tags?.includes(tag));
      }
      return true;
    })
    .map((preset) => ({
      id: preset.id,
      label: preset.label,
      description: preset.description,
      tags: preset.tags ?? [],
      exerciseTypes: preset.exerciseTypes,
      levels: preset.levels,
    }));
}

export function getLibraryPreset(id: string): LibraryPresetDefinition | undefined {
  return presetMap.get(id);
}

export function getLibraryMetadata() {
  return {
    libraryVersion: parsedManifest.libraryVersion,
    updated: parsedManifest.updated,
    total: parsedManifest.presets.length,
  };
}
