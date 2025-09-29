#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import readline from "node:readline";

const GAPFILL_MIN_LENGTH = 40;
const GAPFILL_MAX_LENGTH = 120;
const MATCHING_MIN_PAIRS = 2;
const REQUIRED_HEADERS = {
  gapfill: ["level", "type", "prompt", "answer", "source", "license"],
  matching: ["level", "type", "left", "right", "source", "license"],
  mcq: ["type", "prompt", "options", "answer", "source", "license"],
};

function parseArgs(argv) {
  const packs = [];
  let dir = null;
  let type = "auto";

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--pack") {
      const value = argv[i + 1];
      if (value && !value.startsWith("--")) {
        packs.push(value);
        i += 1;
      }
    } else if (token === "--dir") {
      const value = argv[i + 1];
      if (value && !value.startsWith("--")) {
        dir = value;
        i += 1;
      }
    } else if (token === "--type") {
      const value = argv[i + 1];
      if (value && !value.startsWith("--")) {
        type = value.toLowerCase();
        i += 1;
      }
    }
  }

  return { packs, dir, type };
}

function safeString(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value == null) return "";
  return String(value).trim();
}

function normalizeText(value) {
  return safeString(value).toLowerCase().replace(/\s+/g, " ");
}

function parsePipeList(value) {
  return safeString(value)
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function buildCsvParser() {
  return {
    parseLine(line) {
      const values = [];
      let current = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        if (inQuotes) {
          if (char === "\"") {
            if (line[i + 1] === "\"") {
              current += "\"";
              i += 1;
            } else {
              inQuotes = false;
            }
          } else {
            current += char;
          }
        } else if (char === "\"") {
          inQuotes = true;
        } else if (char === ",") {
          values.push(current);
          current = "";
        } else {
          current += char;
        }
      }
      values.push(current);
      return values;
    },
  };
}

function inferType(filePath) {
  const name = path.basename(filePath).toLowerCase();
  if (name.startsWith("gapfill")) return "gapfill";
  if (name.startsWith("matching")) return "matching";
  if (name.startsWith("mcq")) return "mcq";
  return null;
}

function ensureHeaders(headers, required) {
  const headerSet = new Set(headers.map((header) => header.toLowerCase()));
  const missing = required.filter((column) => !headerSet.has(column));
  return missing;
}

function createGapfillState() {
  return {
    total: 0,
    kept: 0,
    drops: {
      missing: 0,
      blankCount: 0,
      short: 0,
      long: 0,
      duplicate: 0,
      attribution: 0,
    },
    seen: new Set(),
  };
}

function evaluateGapfillRow(row, state) {
  state.total += 1;
  const prompt = safeString(row.prompt ?? row["prompt"]);
  const answer = safeString(row.answer ?? row["answer"]);
  if (!prompt || !answer) {
    state.drops.missing += 1;
    return;
  }
  const blankMatches = prompt.match(/_____/g) ?? [];
  if (blankMatches.length !== 1) {
    state.drops.blankCount += 1;
    return;
  }
  if (prompt.length < GAPFILL_MIN_LENGTH) {
    state.drops.short += 1;
    return;
  }
  if (prompt.length > GAPFILL_MAX_LENGTH) {
    state.drops.long += 1;
    return;
  }
  const attributionMissing = !safeString(row.source ?? row["source"]) || !safeString(row.license ?? row["license"]);
  if (attributionMissing) {
    state.drops.attribution += 1;
    return;
  }
  const key = normalizeText(prompt);
  if (state.seen.has(key)) {
    state.drops.duplicate += 1;
    return;
  }
  state.seen.add(key);
  state.kept += 1;
}

function createMatchingState() {
  return {
    total: 0,
    keptSets: 0,
    keptPairs: 0,
    drops: {
      missing: 0,
      tooFewPairs: 0,
      duplicate: 0,
      attribution: 0,
    },
    mismatchedPairs: 0,
    dedupedPairs: 0,
    seenSets: new Set(),
    seenPairs: new Set(),
  };
}

function evaluateMatchingRow(row, state) {
  state.total += 1;
  const rawLeft = row.left ?? row["left"];
  const rawRight = row.right ?? row["right"];
  const left = parsePipeList(rawLeft);
  const right = parsePipeList(rawRight);
  if (left.length === 0 || right.length === 0) {
    state.drops.missing += 1;
    return;
  }
  const attributionMissing = !safeString(row.source ?? row["source"]) || !safeString(row.license ?? row["license"]);
  if (attributionMissing) {
    state.drops.attribution += 1;
    return;
  }

  const isSetRow = safeString(rawLeft).includes("|") || safeString(rawRight).includes("|") || left.length > 1 || right.length > 1;

  if (!isSetRow) {
    const pairKey = `${normalizeText(left[0])}|${normalizeText(right[0])}`;
    if (state.seenPairs.has(pairKey)) {
      state.drops.duplicate += 1;
      return;
    }
    state.seenPairs.add(pairKey);
    state.keptPairs += 1;
    return;
  }

  const pairCount = Math.min(left.length, right.length);
  if (left.length !== right.length) {
    state.mismatchedPairs += 1;
  }
  const pairs = [];
  const seenPairs = new Set();
  for (let i = 0; i < pairCount; i += 1) {
    const leftValue = left[i];
    const rightValue = right[i];
    const key = `${normalizeText(leftValue)}|${normalizeText(rightValue)}`;
    if (seenPairs.has(key)) {
      state.dedupedPairs += 1;
      continue;
    }
    seenPairs.add(key);
    pairs.push({ left: leftValue, right: rightValue });
  }
  if (pairs.length < MATCHING_MIN_PAIRS) {
    state.drops.tooFewPairs += 1;
    return;
  }
  const setKey = pairs
    .map((pair) => `${normalizeText(pair.left)}|${normalizeText(pair.right)}`)
    .join("||");
  if (state.seenSets.has(setKey)) {
    state.drops.duplicate += 1;
    return;
  }
  state.seenSets.add(setKey);
  state.keptSets += 1;
}

function createMcqState() {
  return {
    total: 0,
    kept: 0,
    drops: {
      missing: 0,
      tooFewOptions: 0,
      answerMismatch: 0,
      duplicate: 0,
      attribution: 0,
    },
    nearDuplicates: 0,
    seen: new Set(),
  };
}

function levenshtein(a, b) {
  const s = a;
  const t = b;
  const m = s.length;
  const n = t.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function evaluateMcqRow(row, state) {
  state.total += 1;
  const prompt = safeString(row.prompt ?? row["prompt"]);
  const answer = safeString(row.answer ?? row["answer"]);
  const source = safeString(row.source ?? row["source"]);
  const license = safeString(row.license ?? row["license"]);
  const options = parsePipeList(row.options ?? row["options"]);

  if (!prompt || !answer || options.length === 0) {
    state.drops.missing += 1;
    return;
  }

  if (!source || !license) {
    state.drops.attribution += 1;
    return;
  }

  if (options.length < 4) {
    state.drops.tooFewOptions += 1;
    return;
  }

  const normalizedAnswer = normalizeText(answer);
  const answerMatches = options.filter((option) => normalizeText(option) === normalizedAnswer).length;
  if (answerMatches !== 1) {
    state.drops.answerMismatch += 1;
    return;
  }

  const key = normalizeText(prompt);
  if (state.seen.has(key)) {
    state.drops.duplicate += 1;
    return;
  }
  state.seen.add(key);

  for (let i = 0; i < options.length; i += 1) {
    for (let j = i + 1; j < options.length; j += 1) {
      const distance = levenshtein(normalizeText(options[i]), normalizeText(options[j]));
      if (distance <= 1) {
        state.nearDuplicates += 1;
        i = options.length;
        break;
      }
    }
  }

  state.kept += 1;
}

async function analyzeFile({ filePath, type }) {
  let headers = [];
  let fatal = false;
  let headerChecked = false;
  const stream = createReadStream(filePath);
  const parser = buildCsvParser();
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;

  const gapfillState = createGapfillState();
  const matchingState = createMatchingState();
  const mcqState = createMcqState();

  for await (let line of rl) {
    lineNumber += 1;
    if (!headerChecked) {
      if (line.startsWith("\ufeff")) {
        line = line.slice(1);
      }
      headers = parser.parseLine(line).map((header) => header.trim());
      const required = REQUIRED_HEADERS[type] ?? [];
      const missing = ensureHeaders(headers, required);
      if (missing.length > 0) {
        fatal = true;
        return {
          filePath,
          type,
          fatal,
          error: `missing required header(s): ${missing.join(", ")}`,
        };
      }
      headerChecked = true;
      continue;
    }

    if (line.trim().length === 0) {
      continue;
    }

    const values = parser.parseLine(line);
    const row = {};
    for (let i = 0; i < headers.length; i += 1) {
      const key = headers[i].toLowerCase();
      row[key] = values[i] ?? "";
    }

    const allEmpty = Object.values(row).every((value) => safeString(value).length === 0);
    if (allEmpty) {
      continue;
    }

    if (type === "gapfill") {
      evaluateGapfillRow(row, gapfillState);
    } else if (type === "matching") {
      evaluateMatchingRow(row, matchingState);
    } else if (type === "mcq") {
      evaluateMcqRow(row, mcqState);
    }
  }

  if (!headerChecked) {
    return {
      filePath,
      type,
      fatal: true,
      error: "missing header row",
    };
  }

  if (type === "gapfill") {
    return {
      filePath,
      type,
      fatal,
      total: gapfillState.total,
      kept: gapfillState.kept,
      drops: gapfillState.drops,
    };
  }

  if (type === "matching") {
    return {
      filePath,
      type,
      fatal,
      total: matchingState.total,
      kept: matchingState.keptSets + matchingState.keptPairs,
      drops: matchingState.drops,
      mismatchedPairs: matchingState.mismatchedPairs,
      dedupedPairs: matchingState.dedupedPairs,
      keptAsPairs: matchingState.keptPairs,
    };
  }

  return {
    filePath,
    type,
    fatal,
    total: mcqState.total,
    kept: mcqState.kept,
    drops: mcqState.drops,
    nearDuplicateOptions: mcqState.nearDuplicates,
  };
}

async function collectFiles({ packs, dir }) {
  if (packs.length > 0) {
    return { files: packs.map((pack) => path.resolve(pack)) };
  }
  const root = dir ? path.resolve(dir) : path.resolve(process.cwd(), "public/packs");
  const files = [];

  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await walk(path.join(current, entry.name));
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".csv")) {
        files.push(path.join(current, entry.name));
      }
    }
  }

  try {
    await walk(root);
  } catch (error) {
    return { error: `unable to read directory: ${root}`, files: [] };
  }

  return { files };
}

function formatSummary(results) {
  const summary = results.map((result) => ({
    file: path.relative(process.cwd(), result.filePath),
    type: result.type,
    fatal: result.fatal,
    total: result.total ?? 0,
    kept: result.kept ?? 0,
    dropped: result.total != null && result.kept != null ? result.total - result.kept : 0,
    drops: result.drops ?? {},
    notes: {
      mismatchedPairs: result.mismatchedPairs ?? 0,
      dedupedPairs: result.dedupedPairs ?? 0,
      nearDuplicateOptions: result.nearDuplicateOptions ?? 0,
      keptPairRows: result.keptAsPairs ?? 0,
    },
    skipped: result.skipped ?? null,
    error: result.error ?? null,
  }));
  return {
    task: "packs-validate",
    files: summary,
  };
}

async function main() {
  const { packs, dir, type } = parseArgs(process.argv.slice(2));
  const forcedType = type !== "auto" ? type : null;
  const singlePackMode = packs.length > 0;
  const collected = await collectFiles({ packs, dir });
  if (collected.error) {
    console.error(collected.error);
    process.exitCode = 1;
    return;
  }
  const fileList = collected.files ?? [];
  if (fileList.length === 0) {
    console.log(JSON.stringify({ task: "packs-validate", files: [] }, null, 2));
    return;
  }

  const results = [];
  for (const filePath of fileList) {
    const inferred = inferType(filePath);
    if (forcedType && !singlePackMode && inferred && inferred !== forcedType) {
      continue;
    }
    const packType = forcedType ?? inferred;
    if (!packType || !REQUIRED_HEADERS[packType]) {
      results.push({
        filePath,
        type: packType ?? "unknown",
        fatal: false,
        skipped: "unsupported pack type",
        total: 0,
        kept: 0,
        drops: {},
      });
      continue;
    }
    const analysis = await analyzeFile({ filePath, type: packType });
    results.push(analysis);
  }

  const summary = formatSummary(results);
  console.log(JSON.stringify(summary, null, 2));

  if (results.some((result) => result.fatal)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
