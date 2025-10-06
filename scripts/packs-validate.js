#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import {
  buildFilterConfig,
  tokenizeSentence,
  isProperNounLike,
  isUnsafe,
  isAcronym,
  recordDrop,
  buildSummaryFragment,
  mergeDropSummaries,
  isFormulaArtifact,
} from "./filter-utils.js";

const GAPFILL_MIN_LENGTH = 40;
const GAPFILL_MAX_LENGTH = 120;
const GAPFILL_BANK_MIN = 4;
const MIN_BANK_BY_LEVEL = {
  A1: 4,
  A2: 5,
  B1: 6,
  B2: 6,
};
const MAX_BLANKS_BY_LEVEL = {
  A1: 1,
  A2: 1,
  B1: 2,
  B2: 2,
};
const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "to",
  "for",
  "with",
  "at",
  "on",
  "in",
  "of",
  "from",
  "by",
  "about",
  "into",
  "over",
  "under",
  "between",
  "and",
  "or",
  "but",
]);
const REQUIRED_HEADERS = {
  gapfill: ["level", "type", "prompt", "source", "license"],
  matching: ["level", "type", "left", "right", "source", "license"],
  mcq: ["type", "prompt", "options", "answer", "source", "license"],
};

function readBooleanOption(options, key, defaultValue) {
  if (!options.has(key)) {
    return defaultValue;
  }
  const raw = options.get(key);
  if (raw === "" || raw == null) {
    return true;
  }
  const lower = String(raw).toLowerCase();
  if (["false", "off", "0", "no"].includes(lower)) return false;
  if (["true", "on", "1", "yes"].includes(lower)) return true;
  return defaultValue;
}

function readPathOption(options, key) {
  if (!options.has(key)) return null;
  const value = options.get(key);
  if (!value) return null;
  return value;
}

function readNumberOption(options, key, defaultValue) {
  if (!options.has(key)) return defaultValue;
  const raw = options.get(key);
  if (raw == null || raw === "") return defaultValue;
  const num = Number(raw);
  return Number.isFinite(num) ? num : defaultValue;
}

function checkUnsafeText(text, filterConfig, dropSummary) {
  if (!filterConfig.sfwPatterns || filterConfig.sfwPatterns.length === 0) return false;
  if (!text) return false;
  if (isUnsafe(text, filterConfig.sfwPatterns, filterConfig.sfwAllowPatterns)) {
    recordDrop(dropSummary, "sfw", text.slice(0, 160));
    return true;
  }
  return false;
}

function evaluateSurface({ surface, tokens, index, sentence, filterConfig, dropSummary }) {
  if (!surface) return false;
  if (isAcronym(surface, filterConfig.acronymMinLen, filterConfig.allowlist)) {
    recordDrop(dropSummary, "acronym", `${surface} :: ${sentence?.slice(0, 120) ?? ""}`);
    return true;
  }
  const proper = isProperNounLike({
    entry: null,
    surface,
    tokens,
    index,
    sentenceInitial: index === 0,
    properSet: filterConfig.properContext,
    nationalitySet: filterConfig.nationalities,
    config: filterConfig,
  });
  if (proper) {
    recordDrop(dropSummary, "proper", `${surface} :: ${sentence?.slice(0, 120) ?? ""}`);
    return true;
  }
  return false;
}

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

function guessPos(word) {
  if (!word) return "";
  const lower = word.toLowerCase();
  if (lower.endsWith("ly")) return "ADV";
  if (lower.endsWith("ing") || lower.endsWith("ed")) return "VERB";
  if (STOPWORDS.has(lower)) return "FUNCTION";
  if (lower.endsWith("ous") || lower.endsWith("ful") || lower.endsWith("ive") || lower.endsWith("al")) return "ADJ";
  if (lower.endsWith("tion") || lower.endsWith("ment") || lower.endsWith("ness") || lower.endsWith("ity")) return "NOUN";
  return "NOUN";
}

function mapToObject(map, { numeric = false } = {}) {
  if (!(map instanceof Map)) {
    return {};
  }
  const entries = Array.from(map.entries());
  const sorted = numeric
    ? entries.sort((a, b) => Number(a[0]) - Number(b[0]))
    : entries.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const result = {};
  for (const [key, value] of sorted) {
    result[String(key)] = value;
  }
  return result;
}

function serializeTelemetry(telemetry) {
  if (!telemetry) {
    return null;
  }
  return {
    banks: telemetry.banks ?? 0,
    relaxed: telemetry.relaxed ?? 0,
    untagged: telemetry.untagged ?? 0,
    tagCounts: mapToObject(telemetry.tagCounts, { numeric: false }),
    sizeBuckets: mapToObject(telemetry.sizeBuckets, { numeric: true }),
  };
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
      bankTooSmall: 0,
      bankMissingAnswer: 0,
      bankDuplicate: 0,
      bankStopword: 0,
      bankMorph: 0,
    },
    seen: new Set(),
    telemetry: {
      banks: 0,
      relaxed: 0,
      tagCounts: new Map(),
      sizeBuckets: new Map(),
      untagged: 0,
    },
  };
}

function evaluateGapfillRow(row, state, filterConfig, filterSummary) {
  state.total += 1;
  const prompt = safeString(row.prompt ?? row["prompt"]);
  const answersRaw = safeString(row.answers ?? row["answers"]);
  const legacyAnswer = safeString(row.answer ?? row["answer"]);
  const answers = answersRaw ? parsePipeList(answersRaw) : legacyAnswer ? [legacyAnswer] : [];
  const answer = answers[0] ?? "";
  const bankMetaRaw = safeString(row.bank_meta ?? row["bank_meta"] ?? row["bankMeta"]);
  let bankMetaSlot = "";
  let bankMeta = null;
  if (bankMetaRaw) {
    try {
      const parsed = JSON.parse(bankMetaRaw);
      if (parsed && typeof parsed === "object") {
        bankMeta = parsed;
        if (typeof parsed.slot === "string") {
          bankMetaSlot = parsed.slot;
        }
      }
    } catch (error) {
      // ignore malformed metadata
      bankMeta = null;
    }
  }
  if (!prompt || !answer) {
    state.drops.missing += 1;
    return;
  }
  const bankRaw = safeString(row.bank ?? row["bank"]);
  const bankOptions = parsePipeList(bankRaw);
  const blankMatches = prompt.match(/_____/g) ?? [];
  const level = safeString(row.level ?? row["level"]).toUpperCase();
  const maxBlanksAllowed = MAX_BLANKS_BY_LEVEL[level] ?? 2;
  if (blankMatches.length === 0 || blankMatches.length > maxBlanksAllowed) {
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
  const minBank = MIN_BANK_BY_LEVEL[level] ?? GAPFILL_BANK_MIN;
  if (bankOptions.length > 0) {
    if (bankOptions.length < minBank) {
      state.drops.bankTooSmall += 1;
      recordDrop(filterSummary, "bankTooSmall", bankOptions.join(" | "));
    }
    const normalizedAnswer = normalizeText(answer);
    const hasAnswer = bankOptions.some((option) => normalizeText(option) === normalizedAnswer);
    if (!hasAnswer) {
      state.drops.bankMissingAnswer += 1;
      recordDrop(filterSummary, "bankMissingAnswer", bankOptions.join(" | "));
    }

    const normalizedBank = bankOptions.map((option) => normalizeText(option));
    const uniqueBank = new Set(normalizedBank);
    if (uniqueBank.size !== normalizedBank.length) {
      state.drops.bankDuplicate += 1;
      recordDrop(filterSummary, "bankDuplicate", bankOptions.join(" | "));
      return;
    }

    const gapModeRaw = safeString(row["gap_mode"] ?? row["gapMode"]).toLowerCase();
    const gapMode = gapModeRaw === "grammar" ? "grammar" : gapModeRaw === "collocation" ? "collocation" : "target";

    if (gapMode !== "grammar") {
      const stopwordHit = bankOptions.some((option) => STOPWORDS.has(option.toLowerCase()));
      if (stopwordHit) {
        state.drops.bankStopword += 1;
        recordDrop(filterSummary, "bankStopword", bankOptions.join(" | "));
        return;
      }
    }

    const answerLower = answer.toLowerCase();
    let enforceSuffix = "";
    if (bankMetaSlot) {
      const parts = bankMetaSlot.split("|");
      const slotPos = (parts[0] ?? "").toUpperCase();
      const slotMorph = (parts[1] ?? "").toLowerCase();
      if (slotPos === "VERB" && ["ing", "ed", "s"].includes(slotMorph)) {
        enforceSuffix = slotMorph;
      }
    }
    if (!enforceSuffix) {
      const needsMorphCheck =
        answerLower.endsWith("ing") ||
        answerLower.endsWith("ed") ||
        (answerLower.endsWith("s") && !answerLower.endsWith("ss"));
      if (needsMorphCheck && !bankMetaSlot) {
        if (answerLower.endsWith("ing")) enforceSuffix = "ing";
        else if (answerLower.endsWith("ed")) enforceSuffix = "ed";
        else enforceSuffix = "s";
      }
    }

    if (enforceSuffix) {
      const morphMismatch = bankOptions.some((option) => !option.toLowerCase().endsWith(enforceSuffix));
      if (morphMismatch) {
        state.drops.bankMorph += 1;
        recordDrop(filterSummary, "bankMorph", bankOptions.join(" | "));
        return;
      }
    }
  }

  const telemetry = state.telemetry;
  if (telemetry) {
    telemetry.banks += 1;
    const sizeKey = String(bankOptions.length);
    telemetry.sizeBuckets.set(sizeKey, (telemetry.sizeBuckets.get(sizeKey) ?? 0) + 1);
    const tags = Array.isArray(bankMeta?.tags) ? bankMeta.tags : null;
    if (tags && tags.length > 0) {
      tags.forEach((tag) => {
        if (!tag) return;
        telemetry.tagCounts.set(tag, (telemetry.tagCounts.get(tag) ?? 0) + 1);
      });
    } else {
      telemetry.untagged += 1;
    }
    if (bankMeta && bankMeta.usedRelax === true) {
      telemetry.relaxed += 1;
    }
  }

  const reconstructed = prompt.includes("_____")
    ? prompt.replace("_____", answer)
    : `${prompt} ${answer}`;
  const tokens = tokenizeSentence(reconstructed);
  const answerLower = answer.toLowerCase();
  let tokenIndex = tokens.findIndex((token) => token.surface.toLowerCase() === answerLower);
  if (tokenIndex < 0) tokenIndex = 0;
  evaluateSurface({
    surface: answer,
    tokens,
    index: tokenIndex,
    sentence: reconstructed,
    filterConfig,
    dropSummary: filterSummary,
  });
  checkUnsafeText(reconstructed, filterConfig, filterSummary);

  state.kept += 1;
}

function createMatchingState() {
  return {
    total: 0,
    keptPairs: 0,
    drops: {
      missing: 0,
      duplicate: 0,
      attribution: 0,
      invalid_format: 0,
    },
    seenPairs: new Set(),
  };
}

function evaluateMatchingRow(row, state, filterConfig, filterSummary) {
  const rawLeft = safeString(row.left ?? row["left"]);
  const rawRight = safeString(row.right ?? row["right"]);
  if (!rawLeft || !rawRight) {
    state.total += 1;
    state.drops.missing += 1;
    return;
  }
  const attributionMissing = !safeString(row.source ?? row["source"]) || !safeString(row.license ?? row["license"]);
  if (attributionMissing) {
    state.total += 1;
    state.drops.attribution += 1;
    return;
  }

  const leftParts = parsePipeList(rawLeft);
  const rightParts = parsePipeList(rawRight);
  state.total += 1;

  if (leftParts.length !== 1 || rightParts.length !== 1) {
    state.drops.invalid_format += 1;
    recordDrop(filterSummary, "invalid_format", `${rawLeft} :: ${rawRight}`);
    return;
  }

  const leftValue = leftParts[0] ?? rawLeft;
  const rightValue = rightParts[0] ?? rawRight;
  if (!leftValue || !rightValue) {
    state.drops.missing += 1;
    return;
  }

  const key = `${normalizeText(leftValue)}|${normalizeText(rightValue)}`;
  if (state.seenPairs.has(key)) {
    state.drops.duplicate += 1;
    return;
  }
  state.seenPairs.add(key);

  const sentence = `the ${leftValue} ${rightValue}`;
  const tokens = [
    { surface: "the", normalized: "the", index: 0 },
    { surface: leftValue, normalized: leftValue.toLowerCase().replace(/[^a-z]+/g, ""), index: 1 },
    { surface: rightValue, normalized: rightValue.toLowerCase().replace(/[^a-z]+/g, ""), index: 2 },
  ];
  evaluateSurface({
    surface: leftValue,
    tokens,
    index: 1,
    sentence,
    filterConfig,
    dropSummary: filterSummary,
  });
  evaluateSurface({
    surface: rightValue,
    tokens,
    index: 2,
    sentence,
    filterConfig,
    dropSummary: filterSummary,
  });
  checkUnsafeText(sentence, filterConfig, filterSummary);
  state.keptPairs += 1;
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
      posMismatch: 0,
    },
    nearDuplicates: 0,
    seen: new Set(),
    promptFingerprints: [],
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

function evaluateMcqRow(row, state, filterConfig, filterSummary) {
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

  const fingerprint = normalizeText(prompt).replace(/[^a-z0-9]/g, "");
  for (const prior of state.promptFingerprints) {
    if (!prior || !fingerprint) continue;
    if (Math.abs(prior.length - fingerprint.length) > 10) continue;
    if (levenshtein(prior, fingerprint) <= 8) {
      state.nearDuplicates += 1;
      recordDrop(filterSummary, "nearDuplicatePrompt", prompt.slice(0, 160));
      break;
    }
  }
  state.promptFingerprints.push(fingerprint);

  for (let i = 0; i < options.length; i += 1) {
    for (let j = i + 1; j < options.length; j += 1) {
      const distance = levenshtein(normalizeText(options[i]), normalizeText(options[j]));
      if (distance <= 1) {
        state.nearDuplicates += 1;
        recordDrop(filterSummary, "nearDuplicateOptions", `${options[i]} :: ${options[j]}`);
        i = options.length;
        break;
      }
    }
  }

  const words = [answer, ...options];
  const posValues = new Set();
  for (const value of words) {
    const firstToken = safeString(value).split(/\s+/)[0] ?? "";
    const pos = guessPos(firstToken);
    if (pos && pos !== "FUNCTION") {
      posValues.add(pos);
    }
  }
  if (posValues.size > 1) {
    state.drops.posMismatch += 1;
    recordDrop(filterSummary, "mcqPosMismatch", `${prompt.slice(0, 120)} :: ${Array.from(posValues).join(",")}`);
  }

  const reconstructed = prompt.includes("_____") ? prompt.replace("_____", answer) : prompt;
  const tokens = tokenizeSentence(reconstructed);
  const answerLower = answer.toLowerCase();
  let tokenIndex = tokens.findIndex((token) => token.surface.toLowerCase() === answerLower);
  if (tokenIndex < 0) tokenIndex = 0;
  evaluateSurface({
    surface: answer,
    tokens,
    index: tokenIndex,
    sentence: reconstructed,
    filterConfig,
    dropSummary: filterSummary,
  });
  checkUnsafeText(reconstructed, filterConfig, filterSummary);
  checkUnsafeText(options.join(" "), filterConfig, filterSummary);
  for (const option of options) {
    if (isAcronym(option, filterConfig.acronymMinLen, filterConfig.allowlist)) {
      recordDrop(filterSummary, "acronym", option);
    }
    if (isFormulaArtifact(option)) {
      recordDrop(filterSummary, "formula", option);
    }
    checkUnsafeText(option, filterConfig, filterSummary);
  }

  state.kept += 1;
}

async function analyzeFile({ filePath, type }, filterConfig) {
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
  const filterSummary = {};

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
      if (type === "gapfill") {
        const headerSet = new Set(headers.map((header) => header.toLowerCase()));
        if (!headerSet.has("answers") && !headerSet.has("answer")) {
          fatal = true;
          return {
            filePath,
            type,
            fatal,
            error: "missing required header(s): answers",
          };
        }
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
      evaluateGapfillRow(row, gapfillState, filterConfig, filterSummary);
    } else if (type === "matching") {
      evaluateMatchingRow(row, matchingState, filterConfig, filterSummary);
    } else if (type === "mcq") {
      evaluateMcqRow(row, mcqState, filterConfig, filterSummary);
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
      filterSummary,
      telemetry: serializeTelemetry(gapfillState.telemetry),
    };
  }

  if (type === "matching") {
    return {
      filePath,
      type,
      fatal,
      total: matchingState.total,
      kept: matchingState.keptPairs,
      drops: matchingState.drops,
      invalidFormatRows: matchingState.drops.invalid_format ?? 0,
      filterSummary,
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
    filterSummary,
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

function formatSummary(results, combinedFilters, aggregatedTelemetry) {
  const summary = results.map((result) => ({
    file: path.relative(process.cwd(), result.filePath),
    type: result.type,
    fatal: result.fatal,
    total: result.total ?? 0,
    kept: result.kept ?? 0,
    dropped: result.total != null && result.kept != null ? result.total - result.kept : 0,
    drops: result.drops ?? {},
    notes: {
      invalidFormatRows: result.invalidFormatRows ?? 0,
      nearDuplicateOptions: result.nearDuplicateOptions ?? 0,
    },
    skipped: result.skipped ?? null,
    error: result.error ?? null,
    filters: result.filters ?? buildSummaryFragment(result.filterSummary ?? {}),
    telemetry: result.telemetry ?? null,
  }));
  return {
    task: "packs-validate",
    files: summary,
    filters: buildSummaryFragment(combinedFilters),
    bankTelemetry: aggregatedTelemetry ?? null,
  };
}

async function main() {
  const { packs, dir, type } = parseArgs(process.argv.slice(2));
  const forcedType = type !== "auto" ? type : null;
  const singlePackMode = packs.length > 0;

  const optionMap = new Map();
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "";
    optionMap.set(token, value);
  }

  const sfwLevelRaw = optionMap.get("--sfwLevel") ? String(optionMap.get("--sfwLevel")).toLowerCase() : null;
  if (optionMap.has("--sfw")) {
    console.warn("`--sfw` is no longer supported. Use --sfwLevel <off|default|strict> instead.");
  }
  let sfwLevel = sfwLevelRaw;
  if (!sfwLevel || !["off", "default", "strict"].includes(sfwLevel)) {
    sfwLevel = "default";
  }
  const dropProperNouns = readBooleanOption(optionMap, "--dropProperNouns", true);
  const strict = readBooleanOption(optionMap, "--strict", false);
  const acronymMinLen = readNumberOption(optionMap, "--acronymMinLen", 3);
  const blockListPath = readPathOption(optionMap, "--blockList");
  const allowListPath = readPathOption(optionMap, "--allowList");
  const properListPath = readPathOption(optionMap, "--properList");
  const nationalitiesPath = readPathOption(optionMap, "--nationalities");
  const sfwAllowPath = readPathOption(optionMap, "--sfwAllow");

  const filterConfig = await buildFilterConfig({
    cwd: process.cwd(),
    blockListPath,
    allowListPath,
    properListPath,
    nationalitiesPath,
    acronymMinLen,
    dropProperNouns,
    sfwLevel,
    sfwAllowPath,
  });

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
  const combinedFilterSummary = {};
  const aggregatedTelemetry = {
    banks: 0,
    relaxed: 0,
    untagged: 0,
    tagCounts: new Map(),
    sizeBuckets: new Map(),
  };
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
    const analysis = await analyzeFile({ filePath, type: packType }, filterConfig);
    if (analysis.filterSummary) {
      analysis.filters = buildSummaryFragment(analysis.filterSummary);
      mergeDropSummaries(combinedFilterSummary, analysis.filterSummary);
    }
    if (analysis.telemetry) {
      aggregatedTelemetry.banks += analysis.telemetry.banks ?? 0;
      aggregatedTelemetry.relaxed += analysis.telemetry.relaxed ?? 0;
      aggregatedTelemetry.untagged += analysis.telemetry.untagged ?? 0;
      const tagCounts = analysis.telemetry.tagCounts ?? {};
      for (const [tag, count] of Object.entries(tagCounts)) {
        aggregatedTelemetry.tagCounts.set(tag, (aggregatedTelemetry.tagCounts.get(tag) ?? 0) + (count ?? 0));
      }
      const sizeBuckets = analysis.telemetry.sizeBuckets ?? {};
      for (const [bucket, count] of Object.entries(sizeBuckets)) {
        aggregatedTelemetry.sizeBuckets.set(bucket, (aggregatedTelemetry.sizeBuckets.get(bucket) ?? 0) + (count ?? 0));
      }
    }
    results.push(analysis);
  }

  const aggregatedPlain = aggregatedTelemetry.banks > 0
    ? {
        banks: aggregatedTelemetry.banks,
        relaxed: aggregatedTelemetry.relaxed,
        untagged: aggregatedTelemetry.untagged,
        tagCounts: mapToObject(aggregatedTelemetry.tagCounts, { numeric: false }),
        sizeBuckets: mapToObject(aggregatedTelemetry.sizeBuckets, { numeric: true }),
      }
    : null;

  const summary = formatSummary(results, combinedFilterSummary, aggregatedPlain);
  summary.sfwLevel = filterConfig.sfwLevel;
  console.log(JSON.stringify(summary, null, 2));

  if (results.some((result) => result.fatal)) {
    process.exitCode = 1;
    return;
  }

  const hasFilterIssues = Object.values(combinedFilterSummary).some((entry) => (entry?.count ?? 0) > 0);
  if (strict && hasFilterIssues) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
