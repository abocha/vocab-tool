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
  severity: "info" | "warning" | "error";
  message: string;
  hint?: string;
  details?: string[];
}

export interface LoadedPack {
  items: ExerciseItem[];
  issues: PackIssue[];
  rowCount: number;
  fingerprint: string;
  matchingDiagnostics?: MatchingDiagnostics | null;
  matchingShape?: "set" | "pair" | "mixed" | null;
}

function createIssueCollector() {
  const seen = new Set<string>();
  const issues: PackIssue[] = [];

  function push(issue: PackIssue) {
    const fingerprint = `${issue.severity}:${issue.message}${issue.hint ?? ""}`;
    if (!seen.has(fingerprint)) {
      seen.add(fingerprint);
      issues.push(issue);
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
  fileName: string,
  rows: RawRow[],
  items: ExerciseItem[],
): string {
  const sampleIds = items.slice(0, 8).map((item) => item.id).join("|");
  const sampleRows = rows
    .slice(0, 8)
    .map((row) => JSON.stringify(row))
    .join("|");
  const base = `${level}:${type}:${fileName}:${rows.length}:${sampleIds}:${sampleRows}`;
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

const MAX_MATCHING_DIAGNOSTIC_EXAMPLES = 5;

export type MatchingExampleType = "mismatch" | "dropped" | "frequency" | "nonNumeric";

export interface MatchingDiagnostics {
  rowsParsed: number;
  setsBuilt: number;
  setsDroppedTooSmall: number;
  rowsWithMismatchedLengths: number;
  rowsWithOutOfRangeCount: number;
  rowsWithNonNumericCount: number;
  shape: "set" | "pair" | "mixed";
  examples: Record<MatchingExampleType, string[]>;
}

interface MatchingDiagnosticsHelper {
  diagnostics: MatchingDiagnostics;
  recordExample: (type: MatchingExampleType, sample: string) => void;
}

function createMatchingDiagnostics(): MatchingDiagnosticsHelper {
  const diagnostics: MatchingDiagnostics = {
    rowsParsed: 0,
    setsBuilt: 0,
    setsDroppedTooSmall: 0,
    rowsWithMismatchedLengths: 0,
    rowsWithOutOfRangeCount: 0,
    rowsWithNonNumericCount: 0,
    shape: "set",
    examples: {
      mismatch: [],
      dropped: [],
      frequency: [],
      nonNumeric: [],
    },
  };

  function recordExample(type: MatchingExampleType, sample: string) {
    const bucket = diagnostics.examples[type];
    if (!bucket) {
      return;
    }
    if (bucket.length >= 25) {
      return;
    }
    bucket.push(sample);
  }

  return { diagnostics, recordExample };
}

interface MatchingGroup {
  pairs: MatchingPair[];
  source?: string;
  license?: string;
  level?: Level;
  rawKeys: string[];
  freq?: number | null;
  sampleRow?: number;
  origin: "set" | "pair";
  groupId?: string;
}

interface PendingSinglePair {
  pair: MatchingPair;
  source?: string;
  license?: string;
  level?: Level;
  rawKey: string;
  index: number;
  freq?: number | null;
}

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

function selectRepresentativeSamples(samples: string[], limit = MAX_MATCHING_DIAGNOSTIC_EXAMPLES): string[] {
  if (samples.length <= limit) {
    return samples;
  }
  const result: string[] = [];
  const maxIndex = samples.length - 1;
  for (let i = 0; i < limit; i += 1) {
    const position = limit === 1 ? 0 : Math.round((i * maxIndex) / (limit - 1));
    const value = samples[position];
    if (!result.includes(value)) {
      result.push(value);
    }
  }
  while (result.length < limit && result.length < samples.length) {
    const candidate = samples[result.length];
    if (!result.includes(candidate)) {
      result.push(candidate);
    } else {
      break;
    }
  }
  return result;
}

function dedupePairs(pairs: MatchingPair[]): MatchingPair[] {
  const seen = new Set<string>();
  const deduped: MatchingPair[] = [];
  pairs.forEach((pair) => {
    const key = `${pair.left.toLowerCase()}→${pair.right.toLowerCase()}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    deduped.push(pair);
  });
  return deduped;
}

function finalizeMatchingSet(
  identifier: string,
  group: MatchingGroup,
  helper: MatchingDiagnosticsHelper,
): MatchingItem | null {
  group.pairs = dedupePairs(group.pairs);
  const pairCount = group.pairs.length;
  if (pairCount < 2) {
    helper.diagnostics.setsDroppedTooSmall += 1;
    helper.recordExample(
      "dropped",
      `set ${identifier} (${pairCount} pair${pairCount === 1 ? "" : "s"})`,
    );
    return null;
  }

  if (group.freq != null && Number.isFinite(group.freq) && group.freq !== pairCount) {
    helper.diagnostics.rowsWithOutOfRangeCount += 1;
    helper.recordExample(
      "frequency",
      `set ${identifier}: count=${group.freq}, pairs=${pairCount}`,
    );
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
    freq: group.freq ?? null,
    origin: group.origin,
    groupId: group.groupId,
  };
}

function buildMatchingRows(
  rows: RawRow[],
): { items: MatchingItem[]; diagnostics: MatchingDiagnostics; shape: "set" | "pair" | "mixed" } {
  const { diagnostics, recordExample } = createMatchingDiagnostics();
  diagnostics.rowsParsed = rows.length;

  const items: MatchingItem[] = [];
  const groupedById = new Map<string, MatchingGroup>();
  const order: string[] = [];
  const singlePairs: PendingSinglePair[] = [];
  let sawSet = false;
  let sawPair = false;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rowNumber = index + 1;

    const leftColumn = safeString(row.left);
    const rightColumn = safeString(row.right);
    const typeValue = safeString(row.type);

    if (typeValue && typeValue.toLowerCase() !== "matching") {
      recordExample("dropped", `row ${rowNumber}: unexpected type '${typeValue}'`);
      diagnostics.setsDroppedTooSmall += 1;
      continue;
    }

    const source = safeString(row.source) || undefined;
    const license = safeString(row.license) || undefined;
    const levelRaw = safeString(row.level);
    const level = levelRaw ? (levelRaw as Level) : undefined;
    const setId = safeString(row.setId ?? row.group ?? "");
    const rawCount = safeString(row.count);
    const declaredCount = parseCount(row.count);
    if (rawCount.length > 0 && declaredCount === null) {
      diagnostics.rowsWithNonNumericCount += 1;
      recordExample("nonNumeric", `row ${rowNumber}: count='${rawCount}' ignored`);
    }

    if (!leftColumn || !rightColumn) {
      diagnostics.setsDroppedTooSmall += 1;
      recordExample("dropped", `row ${rowNumber}: missing left/right value`);
      continue;
    }

    const leftOptions = splitList(leftColumn);
    const rightOptions = splitList(rightColumn);
    const hasMultiple = leftOptions.length > 1 || rightOptions.length > 1;

    if (hasMultiple) {
      const pairCount = Math.min(leftOptions.length, rightOptions.length);
      if (leftOptions.length !== rightOptions.length) {
        diagnostics.rowsWithMismatchedLengths += 1;
        recordExample(
          "mismatch",
          `row ${rowNumber}: left=${leftOptions.length}, right=${rightOptions.length}`,
        );
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

      const group: MatchingGroup = {
        pairs,
        source,
        license,
        level,
        rawKeys: [leftColumn, rightColumn],
        freq: declaredCount,
        sampleRow: rowNumber,
        origin: "set",
        groupId: setId || `row-${rowNumber}`,
      };

      const item = finalizeMatchingSet(setId || `row-${rowNumber}`, group, {
        diagnostics,
        recordExample,
      });
      if (item) {
        items.push(item);
      }
      sawSet = true;
      continue;
    }

    const pair: MatchingPair = {
      left: leftOptions[0] ?? leftColumn,
      right: rightOptions[0] ?? rightColumn,
    };

    if (setId) {
      if (!groupedById.has(setId)) {
        groupedById.set(setId, {
          pairs: [],
          source,
          license,
          level,
          rawKeys: [],
          freq: declaredCount,
          sampleRow: rowNumber,
          origin: "pair",
          groupId: setId,
        });
        order.push(setId);
      }
      const group = groupedById.get(setId)!;
      group.pairs.push(pair);
      group.source = group.source || source;
      group.license = group.license || license;
      group.level = group.level || level;
      group.rawKeys.push(`${pair.left}->${pair.right}`);
      if (group.freq == null && declaredCount != null) {
        group.freq = declaredCount;
      }
      if (group.sampleRow == null) {
        group.sampleRow = rowNumber;
      }
      sawPair = true;
      continue;
    }

    singlePairs.push({
      pair,
      source,
      license,
      level,
      rawKey: `${pair.left}->${pair.right}`,
      index,
      freq: declaredCount,
    });
    sawPair = true;
  }

  if (singlePairs.length === 1) {
    diagnostics.setsDroppedTooSmall += 1;
    recordExample("dropped", `row ${singlePairs[0].index + 1}: single pair without a group`);
  } else if (singlePairs.length > 1) {
    const chunkSizes = planChunkSizes(singlePairs.length);
    let cursor = 0;

    chunkSizes.forEach((size) => {
      const slice = singlePairs.slice(cursor, cursor + size);
      cursor += size;
      if (slice.length < 2) {
        diagnostics.setsDroppedTooSmall += 1;
        recordExample(
          "dropped",
          `row ${slice[0].index + 1}: insufficient pairs after chunking`,
        );
        return;
      }

      const identifier = `chunk-${slice[0].index + 1}`;
      const meta = slice.find((entry) => entry.source || entry.license || entry.level);
      const freqEntry = slice.find((entry) => entry.freq != null);
      const group: MatchingGroup = {
        pairs: slice.map((entry) => entry.pair),
        source: meta?.source,
        license: meta?.license,
        level: meta?.level,
        rawKeys: slice.map((entry) => entry.rawKey),
        freq: freqEntry?.freq ?? null,
        sampleRow: slice[0].index + 1,
        origin: "pair",
        groupId: identifier,
      };
      const item = finalizeMatchingSet(identifier, group, { diagnostics, recordExample });
      if (item) {
        items.push(item);
      }
    });
  }

  order.forEach((identifier) => {
    const group = groupedById.get(identifier);
    if (!group) {
      return;
    }
    const item = finalizeMatchingSet(identifier, group, { diagnostics, recordExample });
    if (item) {
      items.push(item);
    }
  });

  diagnostics.setsBuilt = items.length;
  diagnostics.shape = sawSet && sawPair ? "mixed" : sawPair ? "pair" : "set";

  return { items, diagnostics, shape: diagnostics.shape };
}

function matchingDiagnosticsToIssues(diagnostics: MatchingDiagnostics): PackIssue[] {
  const issues: PackIssue[] = [];

  const metadataCount =
    diagnostics.rowsWithOutOfRangeCount + diagnostics.rowsWithNonNumericCount;

  const summaryMessage = `Summary — rows parsed ${diagnostics.rowsParsed}, sets built ${diagnostics.setsBuilt}, dropped (<2 pairs) ${diagnostics.setsDroppedTooSmall}, mismatched lengths ${diagnostics.rowsWithMismatchedLengths}, count metadata ${metadataCount}, shape ${diagnostics.shape}.`;
  issues.push({ severity: "info", message: summaryMessage });

  if (metadataCount > 0) {
    const frequencySamples = selectRepresentativeSamples(diagnostics.examples.frequency);
    const nonNumericSamples = selectRepresentativeSamples(diagnostics.examples.nonNumeric);
    const details = [...frequencySamples, ...nonNumericSamples];
    issues.push({
      severity: "info",
      message: `${metadataCount} row${metadataCount === 1 ? "" : "s"} included a frequency 'count' value (ignored for set sizing).`,
      hint: `${diagnostics.rowsWithOutOfRangeCount} out-of-range, ${diagnostics.rowsWithNonNumericCount} non-numeric.`,
      details: details.length > 0 ? details : undefined,
    });
  }

  if (diagnostics.shape === "mixed") {
    issues.push({
      severity: "info",
      message: "Matching pack mixes set-per-row and pair-per-row data. Export defaults to set-per-row shape.",
    });
  } else if (diagnostics.shape === "pair") {
    issues.push({
      severity: "info",
      message: "Matching pack detected as pair-per-row. Export preserves pair-per-row schema.",
    });
  }

  if (diagnostics.rowsWithMismatchedLengths > 0) {
    const details = selectRepresentativeSamples(diagnostics.examples.mismatch);
    issues.push({
      severity: "warning",
      message: `${diagnostics.rowsWithMismatchedLengths} row${diagnostics.rowsWithMismatchedLengths === 1 ? "" : "s"} had mismatched left/right lengths; pairs were truncated to the shorter list.`,
      details: details.length > 0 ? details : undefined,
    });
  }

  if (diagnostics.setsDroppedTooSmall > 0) {
    const details = selectRepresentativeSamples(diagnostics.examples.dropped);
    issues.push({
      severity: "error",
      message: `${diagnostics.setsDroppedTooSmall} set${diagnostics.setsDroppedTooSmall === 1 ? "" : "s"} dropped because they contained fewer than 2 pairs.`,
      details: details.length > 0 ? details : undefined,
    });
  }

  return issues;
}

function logMatchingDiagnostics(level: Level, diagnostics: MatchingDiagnostics) {
  if (diagnostics.rowsParsed === 0) {
    return;
  }

  const summary = `Matching loader summary (${level}): rowsParsed=${diagnostics.rowsParsed}, setsBuilt=${diagnostics.setsBuilt}, setsDroppedTooSmall=${diagnostics.setsDroppedTooSmall}, rowsWithMismatchedLengths=${diagnostics.rowsWithMismatchedLengths}, rowsWithOutOfRangeCount=${diagnostics.rowsWithOutOfRangeCount}, rowsWithNonNumericCount=${diagnostics.rowsWithNonNumericCount}`;
  console.log(summary);
  (Object.entries(diagnostics.examples) as Array<[MatchingExampleType, string[]]>).forEach(
    ([type, samples]) => {
      selectRepresentativeSamples(samples).forEach((sample) => {
        console.log(`  example[${type}]: ${sample}`);
      });
    },
  );
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
    return {
      items: [],
      issues: [],
      rowCount: 0,
      fingerprint: createHash(`${level}:${type}:missing-file`),
      matchingDiagnostics: null,
      matchingShape: null,
    };
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
        let matchingDiagnostics: MatchingDiagnostics | null = null;
        let matchingShape: "set" | "pair" | "mixed" | null = null;
        switch (type) {
          case "gapfill":
            items = buildGapFillRows(rows, collector);
            break;
          case "matching":
            ({ items, diagnostics: matchingDiagnostics, shape: matchingShape } = buildMatchingRows(rows));
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

        const combinedIssues: PackIssue[] = [...collector.list];
        if (matchingDiagnostics) {
          combinedIssues.push(...matchingDiagnosticsToIssues(matchingDiagnostics));
          logMatchingDiagnostics(level, matchingDiagnostics);
        }

        resolve({
          items,
          issues: combinedIssues,
          rowCount: rows.length,
          fingerprint: buildPackFingerprint(level, type, fileName, rows, items),
          matchingDiagnostics,
          matchingShape,
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
