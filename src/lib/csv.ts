import Papa, { type ParseError, type ParseRemoteConfig, type ParseResult } from "papaparse";
import { createHash, createItemId } from "./id";
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

const REQUIRED_HEADERS: Record<ExerciseType, string[]> = {
  gapfill: ["level", "type", "prompt", "answer"],
  matching: ["level", "type", "left", "right"],
  mcq: ["type", "prompt", "options", "answer"],
  scramble: ["level", "type", "prompt", "answer"],
};

const MAX_DECLARED_MATCHING_SET_SIZE = 12;

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
  fingerprint: string;
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

function buildPackFingerprint(
  level: Level,
  type: ExerciseType,
  rowCount: number,
  items: ExerciseItem[],
): string {
  const sampleIds = items.slice(0, 12).map((item) => item.id).join("|");
  const base = `${level}:${type}:${rowCount}:${sampleIds}`;
  return createHash(base);
}

function validateHeaders(
  headers: string[] | null,
  type: ExerciseType,
  fileName: string,
  collect: ReturnType<typeof createIssueCollector>,
) {
  if (!headers || headers.length === 0) {
    collect.push({
      severity: "error",
      message: `${fileName} is missing a header row.`,
      hint: "Ensure the CSV includes column names as the first row.",
    });
    return;
  }

  const required = REQUIRED_HEADERS[type] ?? [];
  const headerSet = new Set(headers.map((header) => header.trim().toLowerCase()));
  const missing = required.filter((column) => !headerSet.has(column));

  if (missing.length > 0) {
    collect.push({
      severity: "error",
      message: `${fileName} is missing required column(s): ${missing.join(", ")}.`,
      hint: "See docs/03-csv-pack-spec.md for the expected schema.",
    });
  }
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
    const typeValue = safeString(row.type);
    if (typeValue && typeValue.toLowerCase() !== "gapfill") {
      collect.push({
        severity: "warning",
        message: `Skipped gap-fill row ${index + 1} due to unexpected type value '${typeValue}'.`,
      });
      return;
    }

    const prompt = safeString(row.prompt);
    const answer = safeString(row.answer);
    if (!prompt || !answer) {
      collect.push({
        severity: "warning",
        message: `Skipped gap-fill row ${index + 1} due to missing prompt or answer.`,
      });
      return;
    }

    const levelRaw = safeString(row.level);
    if (!levelRaw) {
      collect.push({
        severity: "warning",
        message: `Gap-fill row ${index + 1} is missing a level value.`,
      });
    }

    const id = createItemId("gapfill", `${prompt}|${answer}`);
    items.push({
      id,
      type: "gapfill",
      prompt,
      answer,
      source: safeString(row.source),
      license: safeString(row.license),
      level: levelRaw ? (levelRaw as Level) : undefined,
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
  let pendingCountGroup: MatchingGroup | null = null;
  let pendingCountExpected: number | null = null;
  let pendingCountIdentifier: string | null = null;
  let countGroupIndex = 0;

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

    const typeValue = safeString(row.type);
    if (typeValue && typeValue.toLowerCase() !== "matching") {
      collect.push({
        severity: "warning",
        message: `Skipped matching row ${index + 1} due to unexpected type value '${typeValue}'.`,
      });
      continue;
    }

    const levelRaw = safeString(row.level);
    if (!levelRaw) {
      collect.push({
        severity: "warning",
        message: `Matching row ${index + 1} is missing a level value.`,
      });
    }
    const level = levelRaw ? (levelRaw as Level) : undefined;
    const source = safeString(row.source);
    const license = safeString(row.license);
    const setId = safeString(row.setId ?? row.group ?? "");
    const declaredCount = parseCount(row.count);
    const useDeclaredCount =
      declaredCount !== null &&
      declaredCount >= 2 &&
      declaredCount <= MAX_DECLARED_MATCHING_SET_SIZE;

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
      if (
        expectedCount !== null &&
        (expectedCount < 2 || expectedCount > MAX_DECLARED_MATCHING_SET_SIZE)
      ) {
        collect.push({
          severity: "warning",
          message: `Matching row ${index + 1} declared count ${expectedCount} (ignored; must be between 2 and ${MAX_DECLARED_MATCHING_SET_SIZE}).`,
        });
      }
      if (expectedCount !== null && expectedCount !== pairs.length) {
        collect.push({
          severity: "warning",
          message: `Matching row ${index + 1} declared count ${expectedCount} but CSV provides ${pairs.length} pair${pairs.length === 1 ? "" : "s"}; using data count.`,
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

    if (declaredCount !== null && !useDeclaredCount) {
      collect.push({
        severity: "warning",
        message: `Matching row ${index + 1} declared count ${declaredCount} (ignored; must be between 2 and ${MAX_DECLARED_MATCHING_SET_SIZE}).`,
      });
    }

    if (useDeclaredCount) {
      if (
        !pendingCountGroup ||
        (pendingCountExpected !== null && pendingCountGroup.pairs.length >= pendingCountExpected)
      ) {
        if (
          pendingCountGroup &&
          pendingCountExpected !== null &&
          pendingCountGroup.pairs.length > 0 &&
          pendingCountGroup.pairs.length !== pendingCountExpected
        ) {
          collect.push({
            severity: "warning",
            message: `Matching set ${pendingCountIdentifier ?? "(count)"} expected ${pendingCountExpected} pairs but found ${pendingCountGroup.pairs.length}.`,
          });
        }

        countGroupIndex += 1;
        pendingCountIdentifier = `count-${countGroupIndex}`;
        pendingCountGroup = {
          pairs: [],
          source: source || undefined,
          license: license || undefined,
          level: level || undefined,
          rawKeys: [],
        };
        pendingCountExpected = declaredCount;
      }

      if (pendingCountGroup) {
        pendingCountGroup.pairs.push(pair);
        if (source) {
          pendingCountGroup.source = pendingCountGroup.source || source;
        }
        if (license) {
          pendingCountGroup.license = pendingCountGroup.license || license;
        }
        if (level) {
          pendingCountGroup.level = pendingCountGroup.level || level;
        }
        pendingCountGroup.rawKeys.push(`${pair.left}->${pair.right}`);

        if (
          pendingCountExpected !== null &&
          pendingCountGroup.pairs.length === pendingCountExpected
        ) {
          const item = normalizeMatchingSet(
            pendingCountIdentifier ?? `count-${countGroupIndex}`,
            pendingCountGroup,
            collect,
          );
          if (item) {
            items.push(item);
          }
          pendingCountGroup = null;
          pendingCountExpected = null;
          pendingCountIdentifier = null;
        }
        continue;
      }
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
      }
    });
  }

  if (
    pendingCountGroup &&
    pendingCountExpected !== null &&
    pendingCountGroup.pairs.length > 0
  ) {
    collect.push({
      severity: "warning",
      message: `Matching set ${pendingCountIdentifier ?? "(count)"} expected ${pendingCountExpected} pairs but encountered end of file after ${pendingCountGroup.pairs.length}.`,
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

  return items;
}

function buildMcqRows(rows: RawRow[], collect: ReturnType<typeof createIssueCollector>): McqItem[] {
  const items: McqItem[] = [];
  rows.forEach((row, index) => {
    const typeValue = safeString(row.type);
    if (typeValue && typeValue.toLowerCase() !== "mcq") {
      collect.push({
        severity: "warning",
        message: `Skipped MCQ row ${index + 1} due to unexpected type value '${typeValue}'.`,
      });
      return;
    }

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
    if (options.length < 2) {
      collect.push({
        severity: "warning",
        message: `Skipped MCQ row ${index + 1} because it has fewer than two options.`,
      });
      return;
    }
    if (!options.includes(answer)) {
      collect.push({
        severity: "warning",
        message: `MCQ row ${index + 1} answer '${answer}' is not present in options.`,
      });
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
    const typeValue = safeString(row.type);
    if (typeValue && typeValue.toLowerCase() !== "scramble") {
      collect.push({
        severity: "warning",
        message: `Skipped scramble row ${index + 1} due to unexpected type value '${typeValue}'.`,
      });
      return;
    }

    const prompt = safeString(row.prompt);
    const answer = safeString(row.answer);
    if (!prompt || !answer) {
      collect.push({
        severity: "warning",
        message: `Skipped scramble row ${index + 1} due to missing prompt or answer.`,
      });
      return;
    }
    const levelRaw = safeString(row.level);
    if (!levelRaw) {
      collect.push({
        severity: "warning",
        message: `Scramble row ${index + 1} is missing a level value.`,
      });
    }
    const id = createItemId("scramble", `${prompt}|${answer}`);
    items.push({
      id,
      type: "scramble",
      prompt,
      answer,
      source: safeString(row.source),
      license: safeString(row.license),
      level: levelRaw ? (levelRaw as Level) : undefined,
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
    let headers: string[] | null = null;

    const config: ParseRemoteConfig<RawRow> = {
      download: true,
      header: true,
      skipEmptyLines: "greedy",
      worker: false,
      chunkSize: 64 * 1024,
      chunk: (results: ParseResult<RawRow>) => {
        if (!headers && results.meta && Array.isArray(results.meta.fields)) {
          headers = results.meta.fields.map((field) =>
            typeof field === "string" ? field.trim() : "",
          );
        }
        rows.push(...results.data);
        if (results.errors && results.errors.length > 0) {
          parseIssues.push(...results.errors);
        }
      },
      complete: () => {
        validateHeaders(headers, type, fileName, collector);

        if (rows.length === 0) {
          collector.push({
            severity: "warning",
            message: `${fileName} contains no data rows.`,
            hint: "Populate the CSV or verify the export path.",
          });
        }

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

        if (rows.length > 0 && items.length === 0) {
          collector.push({
            severity: "warning",
            message: `Parsed ${rows.length} row(s) from ${fileName} but none passed validation.`,
            hint: "Check required columns, type values, and blank fields.",
          });
        }

        resolve({
          items,
          issues: collector.list,
          rowCount: rows.length,
          fingerprint: buildPackFingerprint(level, type, rows.length, items),
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
