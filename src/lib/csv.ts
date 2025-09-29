import Papa, { type ParseError, type ParseRemoteConfig, type ParseResult } from "papaparse";
import { createItemId } from "./id";
import type {
  ExerciseItem,
  ExerciseType,
  GapFillItem,
  Level,
  MatchingItem,
  MatchingPair,
  McqItem,
  ScrambleItem,
} from "../types";

const FILE_MAP: Record<ExerciseType, string> = {
  gapfill: "gapfill.csv",
  matching: "matching.csv",
  mcq: "mcq.csv",
  scramble: "scramble.csv",
};

function safeString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return "";
  }
  return String(value);
}

type RawRow = Record<string, unknown>;

function splitList(value: string): string[] {
  return value
    .split("|")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export interface PackIssue {
  severity: "warning" | "error";
  message: string;
  hint?: string;
}

export interface LoadedPack {
  items: ExerciseItem[];
  issues: PackIssue[];
  rowCount: number;
}

function createIssueCollector() {
  const seen = new Set<string>();
  const issues: PackIssue[] = [];

  function push(issue: PackIssue) {
    const fingerprint = `${issue.severity}:${issue.message}${issue.hint ?? ""}`;
    if (!seen.has(fingerprint)) {
      seen.add(fingerprint);
      issues.push(issue);
      console.warn(issue.message, issue.hint ?? "");
    }
  }

  return {
    push,
    list: issues,
  };
}

function parseCount(value: unknown): number | null {
  const raw = safeString(value);
  if (!raw) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

function buildGapFillRows(rows: RawRow[], collect: ReturnType<typeof createIssueCollector>): GapFillItem[] {
  const items: GapFillItem[] = [];
  rows.forEach((row, index) => {
    const prompt = safeString(row.prompt);
    const answer = safeString(row.answer);
    if (!prompt || !answer) {
      collect.push({
        severity: "warning",
        message: `Skipped gap-fill row ${index + 1} due to missing prompt or answer.`,
      });
      return;
    }
    const id = createItemId("gapfill", `${prompt}|${answer}`);
    items.push({
      id,
      type: "gapfill",
      prompt,
      answer,
      source: safeString(row.source),
      license: safeString(row.license),
      level: safeString(row.level) as Level,
    });
  });
  return items;
}

interface MatchingGroup {
  pairs: MatchingPair[];
  source?: string;
  license?: string;
  level?: Level;
  rawKeys: string[];
}

function normalizeMatchingSet(
  identifier: string,
  group: MatchingGroup,
  collect: ReturnType<typeof createIssueCollector>,
): MatchingItem | null {
  if (group.pairs.length === 0) {
    collect.push({
      severity: "warning",
      message: `Matching set ${identifier} has no valid pairs and was skipped.`,
    });
    return null;
  }

  const uniqueKey = group.rawKeys.join("|");
  const id = createItemId("matching", uniqueKey || identifier);
  return {
    id,
    type: "matching",
    pairs: group.pairs,
    source: group.source,
    license: group.license,
    level: group.level,
  };
}

function buildMatchingRows(rows: RawRow[], collect: ReturnType<typeof createIssueCollector>): MatchingItem[] {
  const items: MatchingItem[] = [];
  const groupedById = new Map<string, MatchingGroup>();
  const order: string[] = [];
  const shapesSeen: Set<"set" | "pair"> = new Set();
  let chunkedGroupCount = 0;

  type PendingSinglePair = {
    pair: MatchingPair;
    source?: string;
    license?: string;
    level?: Level;
    rawKey: string;
    index: number;
  };

  const singlePairs: PendingSinglePair[] = [];

  function planChunkSizes(total: number): number[] {
    const sizes: number[] = [];
    let remaining = total;

    while (remaining > 0) {
      if (remaining === 1) {
        if (sizes.length > 0) {
          sizes[sizes.length - 1] += 1;
        } else {
          sizes.push(1);
        }
        break;
      }

      if (remaining <= 5) {
        sizes.push(remaining);
        break;
      }

      const remainder = remaining % 4;
      if (remainder === 1 && remaining >= 5) {
        sizes.push(5);
        remaining -= 5;
        continue;
      }
      if (remainder === 2) {
        sizes.push(3);
        remaining -= 3;
        continue;
      }

      sizes.push(4);
      remaining -= 4;
    }

    return sizes;
  }

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const leftColumn = safeString(row.left);
    const rightColumn = safeString(row.right);
    if (!leftColumn || !rightColumn) {
      collect.push({
        severity: "warning",
        message: `Skipped matching row ${index + 1} with missing left/right values.`,
      });
      continue;
    }

    const level = safeString(row.level) as Level;
    const source = safeString(row.source);
    const license = safeString(row.license);
    const setId = safeString(row.setId ?? row.group ?? "");

    const leftOptions = splitList(leftColumn);
    const rightOptions = splitList(rightColumn);
    const hasMultiple = leftOptions.length > 1 || rightOptions.length > 1;

    if (hasMultiple) {
      shapesSeen.add("set");
      const pairCount = Math.min(leftOptions.length, rightOptions.length);
      if (leftOptions.length !== rightOptions.length) {
        collect.push({
          severity: "warning",
          message: `Matching row ${index + 1} has unequal left/right counts. Extra entries were dropped.`,
        });
      }

      const pairs: MatchingPair[] = [];
      for (let i = 0; i < pairCount; i += 1) {
        const left = leftOptions[i];
        const right = rightOptions[i];
        if (!left || !right) {
          continue;
        }
        pairs.push({ left, right });
      }

      const expectedCount = parseCount(row.count);
      if (expectedCount !== null && expectedCount !== pairs.length) {
        collect.push({
          severity: "warning",
          message: `Matching row ${index + 1} expected ${expectedCount} pairs but found ${pairs.length}.`,
        });
      }

      const identifier = setId || `row-${index + 1}`;
      const item = normalizeMatchingSet(
        identifier,
        {
          pairs,
          source,
          license,
          level,
          rawKeys: [leftColumn, rightColumn],
        },
        collect,
      );
      if (item) {
        items.push(item);
      }
      continue;
    }

    const pair: MatchingPair = {
      left: leftOptions[0] ?? leftColumn,
      right: rightOptions[0] ?? rightColumn,
    };

    shapesSeen.add("pair");

    if (setId) {
      if (!groupedById.has(setId)) {
        groupedById.set(setId, {
          pairs: [],
          source,
          license,
          level,
          rawKeys: [],
        });
        order.push(setId);
      }
      const group = groupedById.get(setId)!;
      group.pairs.push(pair);
      group.source = group.source || source;
      group.license = group.license || license;
      group.level = group.level || level;
      group.rawKeys.push(`${pair.left}->${pair.right}`);
      continue;
    }

    singlePairs.push({
      pair,
      source: source || undefined,
      license: license || undefined,
      level: level || undefined,
      rawKey: `${pair.left}->${pair.right}`,
      index,
    });
  }

  if (singlePairs.length === 1) {
    const onlyPair = singlePairs[0];
    collect.push({
      severity: "warning",
      message: `Matching row ${onlyPair.index + 1} could not form a multi-pair set and was skipped.`,
    });
  } else if (singlePairs.length > 1) {
    const chunkSizes = planChunkSizes(singlePairs.length);
    let cursor = 0;

    chunkSizes.forEach((size) => {
      const slice = singlePairs.slice(cursor, cursor + size);
      cursor += size;
      if (slice.length < 2) {
        if (slice.length === 1) {
          collect.push({
            severity: "warning",
            message: `Matching row ${slice[0].index + 1} was skipped because it did not have enough pairs to form a set.`,
          });
        }
        return;
      }

      const identifier = `chunk-${slice[0].index + 1}`;
      const group: MatchingGroup = {
        pairs: slice.map((entry) => entry.pair),
        source: slice.find((entry) => Boolean(entry.source))?.source,
        license: slice.find((entry) => Boolean(entry.license))?.license,
        level: slice.find((entry) => Boolean(entry.level))?.level,
        rawKeys: slice.map((entry) => entry.rawKey),
      };
      const item = normalizeMatchingSet(identifier, group, collect);
      if (item) {
        items.push(item);
        chunkedGroupCount += 1;
      }
    });
  }

  order.forEach((identifier) => {
    const group = groupedById.get(identifier);
    if (!group) {
      return;
    }
    const item = normalizeMatchingSet(identifier, group, collect);
    if (item) {
      items.push(item);
    }
  });

  if (shapesSeen.has("set") && shapesSeen.has("pair")) {
    collect.push({
      severity: "warning",
      message: "Matching pack mixes set-per-row and pair-per-row entries. Normalized automatically.",
      hint: "Verify setId values to keep intended groupings together.",
    });
  }

  if (chunkedGroupCount > 0) {
    collect.push({
      severity: "warning",
      message: `Formed ${chunkedGroupCount} matching set(s) by chunking rows without setId.`,
      hint: "Add a setId column to control pair grouping explicitly.",
    });
  }

  return items;
}

function buildMcqRows(rows: RawRow[], collect: ReturnType<typeof createIssueCollector>): McqItem[] {
  const items: McqItem[] = [];
  rows.forEach((row, index) => {
    const prompt = safeString(row.prompt);
    const optionsRaw = safeString(row.options);
    const answer = safeString(row.answer);
    if (!prompt || !optionsRaw || !answer) {
      collect.push({
        severity: "warning",
        message: `Skipped MCQ row ${index + 1} due to missing prompt, options, or answer.`,
      });
      return;
    }
    const options = splitList(optionsRaw);
    if (options.length === 0) {
      collect.push({
        severity: "warning",
        message: `Skipped MCQ row ${index + 1} because options could not be parsed.`,
      });
      return;
    }
    const id = createItemId("mcq", `${prompt}|${answer}`);
    items.push({
      id,
      type: "mcq",
      prompt,
      options,
      answer,
      source: safeString(row.source),
      license: safeString(row.license),
    });
  });
  return items;
}

function buildScrambleRows(
  rows: RawRow[],
  collect: ReturnType<typeof createIssueCollector>,
): ScrambleItem[] {
  const items: ScrambleItem[] = [];
  rows.forEach((row, index) => {
    const prompt = safeString(row.prompt);
    const answer = safeString(row.answer);
    if (!prompt || !answer) {
      collect.push({
        severity: "warning",
        message: `Skipped scramble row ${index + 1} due to missing prompt or answer.`,
      });
      return;
    }
    const id = createItemId("scramble", `${prompt}|${answer}`);
    items.push({
      id,
      type: "scramble",
      prompt,
      answer,
      source: safeString(row.source),
      license: safeString(row.license),
      level: safeString(row.level) as Level,
    });
  });
  return items;
}

const packCache = new Map<string, Promise<LoadedPack>>();

export async function loadExercises(level: Level, type: ExerciseType): Promise<LoadedPack> {
  const fileName = FILE_MAP[type];
  if (!fileName) {
    return { items: [], issues: [], rowCount: 0 };
  }

  const url = `/packs/${level}/${fileName}`;
  const cacheKey = `${level}:${type}`;
  if (packCache.has(cacheKey)) {
    return packCache.get(cacheKey)!;
  }

  const promise = new Promise<LoadedPack>((resolve, reject) => {
    const rows: RawRow[] = [];
    const parseIssues: ParseError[] = [];
    const collector = createIssueCollector();

    const config: ParseRemoteConfig<RawRow> = {
      download: true,
      header: true,
      skipEmptyLines: "greedy",
      worker: true,
      chunkSize: 64 * 1024,
      chunk: (results: ParseResult<RawRow>) => {
        rows.push(...results.data);
        if (results.errors && results.errors.length > 0) {
          parseIssues.push(...results.errors);
        }
      },
      complete: () => {
        if (parseIssues.length > 0) {
          collector.push({
            severity: "warning",
            message: `Encountered ${parseIssues.length} parse warnings while reading ${fileName}.`,
            hint: "Rows with issues were skipped where possible.",
          });
        }

        let items: ExerciseItem[] = [];
        switch (type) {
          case "gapfill":
            items = buildGapFillRows(rows, collector);
            break;
          case "matching":
            items = buildMatchingRows(rows, collector);
            break;
          case "mcq":
            items = buildMcqRows(rows, collector);
            break;
          case "scramble":
            items = buildScrambleRows(rows, collector);
            break;
          default:
            items = [];
        }

        resolve({
          items,
          issues: collector.list,
          rowCount: rows.length,
        });
      },
      error: (error: Error) => {
        collector.push({
          severity: "error",
          message: `Failed to load ${fileName}.`,
          hint: error.message,
        });
        packCache.delete(cacheKey);
        reject(error);
      },
    };

    Papa.parse<RawRow>(url, config);
  });

  packCache.set(cacheKey, promise);

  try {
    return await promise;
  } catch (error) {
    packCache.delete(cacheKey);
    throw error;
  }
}

export function clearPackCache() {
  packCache.clear();
}
