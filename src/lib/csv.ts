import Papa, { type ParseError, type ParseRemoteConfig, type ParseResult } from "papaparse";
import { createHash, createItemId } from "./id";
import type {
  ExerciseItem,
  ExerciseType,
  GapFillItem,
  Level,
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
  matchingShape?: "pair" | "legacy" | "mixed" | null;
  matchingPairs?: MatchingPair[] | null;
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

type MatchingExampleType = "legacy" | "duplicate";

export interface MatchingDiagnostics {
  rowsParsed: number;
  pairsParsed: number;
  duplicatePairsDropped: number;
  legacyRows: number;
  shape: "pair" | "legacy" | "mixed";
  examples: Record<MatchingExampleType, string[]>;
}

function createMatchingDiagnostics(): MatchingDiagnostics {
  return {
    rowsParsed: 0,
    pairsParsed: 0,
    duplicatePairsDropped: 0,
    legacyRows: 0,
    shape: "pair",
    examples: {
      legacy: [],
      duplicate: [],
    },
  };
}

function recordMatchingExample(
  diagnostics: MatchingDiagnostics,
  type: MatchingExampleType,
  sample: string,
): void {
  const bucket = diagnostics.examples[type];
  if (!bucket) return;
  if (bucket.length >= 25) return;
  bucket.push(sample);
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

function normalizePairKey(left: string, right: string): string {
  return `${left.toLowerCase().trim()}→${right.toLowerCase().trim()}`;
}

function buildMatchingPairs(
  rows: RawRow[],
  collect: ReturnType<typeof createIssueCollector>,
): { pairs: MatchingPair[]; diagnostics: MatchingDiagnostics; shape: "pair" | "legacy" | "mixed" } {
  const diagnostics = createMatchingDiagnostics();
  diagnostics.rowsParsed = rows.length;

  const pairs: MatchingPair[] = [];
  const seenPairs = new Set<string>();
  let sawLegacy = false;
  let sawPairRow = false;

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const leftRaw = safeString(row.left);
    const rightRaw = safeString(row.right);
    const typeValue = safeString(row.type);

    if (typeValue && typeValue.toLowerCase() !== "matching") {
      collect.push({
        severity: "warning",
        message: `Skipped row ${rowNumber} due to unexpected type '${typeValue}'.`,
      });
      return;
    }

    if (!leftRaw || !rightRaw) {
      collect.push({
        severity: "warning",
        message: `Skipped matching row ${rowNumber} due to missing left or right value.`,
      });
      return;
    }

    const leftParts = splitList(leftRaw);
    const rightParts = splitList(rightRaw);
    const isLegacy = leftRaw.includes("|") || rightRaw.includes("|") || leftParts.length > 1 || rightParts.length > 1;
    if (isLegacy) {
      diagnostics.legacyRows += 1;
      sawLegacy = true;
      recordMatchingExample(diagnostics, "legacy", `row ${rowNumber}: ${leftRaw} ↔ ${rightRaw}`);
    } else {
      sawPairRow = true;
    }

    const pairCount = isLegacy ? Math.min(leftParts.length, rightParts.length) : 1;
    if (isLegacy && pairCount === 0) {
      collect.push({
        severity: "warning",
        message: `Legacy row ${rowNumber} did not contain aligned pairs and was skipped.`,
      });
      return;
    }

    const levelRaw = safeString(row.level);
    const level = levelRaw ? (levelRaw as Level) : undefined;
    const source = safeString(row.source) || undefined;
    const license = safeString(row.license) || undefined;

    const emitPair = (left: string, right: string) => {
      if (!left || !right) {
        return;
      }
      const key = normalizePairKey(left, right);
      if (seenPairs.has(key)) {
        diagnostics.duplicatePairsDropped += 1;
        recordMatchingExample(diagnostics, "duplicate", `row ${rowNumber}: ${left} ↔ ${right}`);
        return;
      }
      seenPairs.add(key);
      diagnostics.pairsParsed += 1;
      pairs.push({
        level,
        left,
        right,
        source,
        license,
      });
    };

    if (isLegacy) {
      for (let i = 0; i < pairCount; i += 1) {
        emitPair(leftParts[i], rightParts[i]);
      }
    } else {
      emitPair(leftParts[0] ?? leftRaw, rightParts[0] ?? rightRaw);
    }
  });

  const shape = sawLegacy && sawPairRow ? "mixed" : sawLegacy ? "legacy" : "pair";
  diagnostics.shape = shape;

  return { pairs, diagnostics, shape };
}

function matchingDiagnosticsToIssues(diagnostics: MatchingDiagnostics): PackIssue[] {
  const issues: PackIssue[] = [];

  const summaryMessage = `Summary — rows parsed ${diagnostics.rowsParsed}, pairs kept ${diagnostics.pairsParsed}, duplicates dropped ${diagnostics.duplicatePairsDropped}, legacy rows ${diagnostics.legacyRows}, shape ${diagnostics.shape}.`;
  issues.push({ severity: "info", message: summaryMessage });

  if (diagnostics.shape === "mixed") {
    issues.push({
      severity: "info",
      message: "Matching pack mixes deprecated set-per-row data with pair-per-row pairs.",
    });
  } else if (diagnostics.shape === "legacy") {
    issues.push({
      severity: "warning",
      message: "Matching pack detected entirely in deprecated set-per-row format.",
      hint: "Convert to pair-per-row for deterministic grouping and validation.",
    });
  }

  if (diagnostics.legacyRows > 0) {
    const legacyExamples = selectRepresentativeSamples(diagnostics.examples.legacy);
    issues.push({
      severity: "warning",
      message: `This matching pack uses a deprecated set-per-row format (${diagnostics.legacyRows} legacy row${diagnostics.legacyRows === 1 ? "" : "s"}). Convert to pair-per-row for best results.`,
      hint: "Run scripts/convert-matching-set-to-pairs.js to migrate existing CSVs.",
      details: legacyExamples.length > 0 ? legacyExamples : undefined,
    });
  }

  if (diagnostics.duplicatePairsDropped > 0) {
    const duplicateExamples = selectRepresentativeSamples(diagnostics.examples.duplicate);
    issues.push({
      severity: "info",
      message: `${diagnostics.duplicatePairsDropped} duplicate pair${diagnostics.duplicatePairsDropped === 1 ? "" : "s"} removed during load.`,
      details: duplicateExamples.length > 0 ? duplicateExamples : undefined,
    });
  }

  return issues;
}

function logMatchingDiagnostics(level: Level, diagnostics: MatchingDiagnostics) {
  if (diagnostics.rowsParsed === 0) {
    return;
  }

  const summary = `Matching loader summary (${level}): rowsParsed=${diagnostics.rowsParsed}, pairsParsed=${diagnostics.pairsParsed}, duplicatePairsDropped=${diagnostics.duplicatePairsDropped}, legacyRows=${diagnostics.legacyRows}, shape=${diagnostics.shape}`;
  console.log(summary);
  (Object.entries(diagnostics.examples) as Array<[MatchingExampleType, string[]]>).forEach(([type, samples]) => {
    selectRepresentativeSamples(samples).forEach((sample) => {
      console.log(`  example[${type}]: ${sample}`);
    });
  });
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
        let matchingShape: "pair" | "legacy" | "mixed" | null = null;
        let matchingPairs: MatchingPair[] | null = null;
        switch (type) {
          case "gapfill":
            items = buildGapFillRows(rows, collector);
            break;
          case "matching":
            {
              const result = buildMatchingPairs(rows, collector);
              matchingDiagnostics = result.diagnostics;
              matchingShape = result.shape;
              matchingPairs = result.pairs;
              items = result.pairs.map((pair, pairIndex) => ({
                id: createItemId("matching", `${pair.left}|${pair.right}|${pairIndex}`),
                type: "matching" as const,
                pairs: [pair],
                source: pair.source,
                license: pair.license,
                level: pair.level && typeof pair.level === "string" ? (pair.level as Level) : undefined,
              }));
            }
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
          matchingPairs,
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
