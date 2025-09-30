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
  normalizeToken,
} from "./filter-utils.js";

const SOURCE_FALLBACK = "simplewiki";
const LICENSE_FALLBACK = "CC BY-SA";
const GAPFILL_MIN_LENGTH = 40;
const GAPFILL_MAX_LENGTH = 120;
const MATCHING_MIN_PAIRS = 2;
const MATCHING_MAX_PAIRS = 12;
const DISTRACTOR_TOLERANCE = 0.3;

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

function parseArgs(argv) {
  const opts = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "";
    opts.set(token, value);
  }
  return opts;
}

function toNumber(value) {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function attemptCloze(sentence, lemma) {
  if (!sentence || !lemma) return null;
  const regex = new RegExp(`\\b${escapeRegex(lemma)}\\b`, "i");
  const matched = regex.exec(sentence);
  if (!matched) return { success: false, reason: "noLemma" };
  const answer = matched[0];
  const prompt = sentence.replace(regex, "_____");
  const trimmed = prompt.trim();
  if (trimmed.length < GAPFILL_MIN_LENGTH) {
    return { success: false, reason: "short" };
  }
  if (trimmed.length > GAPFILL_MAX_LENGTH) {
    return { success: false, reason: "long" };
  }
  const tokens = tokenizeSentence(sentence);
  let targetIndex = -1;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;
    const tokenEnd = token.index + token.surface.length;
    const matchStart = matched.index ?? sentence.indexOf(answer);
    const matchEnd = matchStart + answer.length;
    if (token.index === matchStart || (token.index <= matchStart && tokenEnd >= matchEnd)) {
      targetIndex = i;
      break;
    }
    if (token.surface.toLowerCase() === answer.toLowerCase() && targetIndex === -1) {
      targetIndex = i;
    }
  }
  return {
    success: true,
    prompt: trimmed,
    answer,
    sentence,
    tokens,
    targetIndex,
  };
}

function normalizePrompt(prompt) {
  return prompt.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizePair(left, right) {
  return `${left.toLowerCase()}|${right.toLowerCase()}`;
}

function deterministicHash(str) {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function deterministicShuffle(items, seed) {
  const result = [...items];
  let hash = deterministicHash(seed);
  for (let i = result.length - 1; i > 0; i -= 1) {
    hash = (hash * 1664525 + 1013904223) >>> 0;
    const j = hash % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function evaluateSurface({ surface, tokens, index, sentence, filterConfig, dropSummary }) {
  if (!surface) return null;
  if (isFormulaArtifact(surface)) {
    recordDrop(dropSummary, "formula", `${surface} :: ${sentence?.slice(0, 120) ?? ""}`);
    return "formula";
  }
  if (isAcronym(surface, filterConfig.acronymMinLen, filterConfig.allowlist)) {
    recordDrop(dropSummary, "acronym", `${surface} :: ${sentence?.slice(0, 120) ?? ""}`);
    return "acronym";
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
    return "proper";
  }

  return null;
}

function checkUnsafeText(text, filterConfig, dropSummary) {
  if (!filterConfig.sfwPatterns || filterConfig.sfwPatterns.length === 0) return null;
  if (!text) return null;
  if (isUnsafe(text, filterConfig.sfwPatterns, filterConfig.sfwAllowPatterns)) {
    recordDrop(dropSummary, "sfw", text.slice(0, 160));
    return "sfw";
  }
  return null;
}

function normalizeOptionValue(value) {
  return value ? value.toLowerCase().replace(/[^a-z0-9]+/g, "") : "";
}

function levenshteinDistance(a, b) {
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

function hasNearDuplicateOptions(options, answer) {
  const normalized = options.map((option) => normalizeOptionValue(option));
  for (let i = 0; i < normalized.length; i += 1) {
    for (let j = i + 1; j < normalized.length; j += 1) {
      const a = normalized[i];
      const b = normalized[j];
      if (!a || !b) continue;
      if (a === b) return true;
      if (levenshteinDistance(a, b) <= 1) return true;
      const shorter = a.length <= b.length ? a : b;
      const longer = a.length > b.length ? a : b;
      if (shorter.length > 0 && shorter.length < 6 && longer.includes(shorter)) {
        return true;
      }
    }
  }
  const answerNorm = normalizeOptionValue(answer);
  for (const option of normalized) {
    if (!option) continue;
    if (option === answerNorm) continue;
    const shorter = option.length <= answerNorm.length ? option : answerNorm;
    const longer = option.length > answerNorm.length ? option : answerNorm;
    if (shorter.length > 0 && shorter.length < 6 && longer.includes(shorter)) {
      return true;
    }
  }
  return false;
}

function generateDistractorCombos(pool, maxCombos = 12) {
  const combos = [];
  const n = pool.length;
  for (let i = 0; i < n && combos.length < maxCombos; i += 1) {
    for (let j = i + 1; j < n && combos.length < maxCombos; j += 1) {
      for (let k = j + 1; k < n && combos.length < maxCombos; k += 1) {
        combos.push([pool[i], pool[j], pool[k]]);
      }
    }
  }
  return combos;
}

async function loadCards(filePath) {
  const cards = [];
  const stream = createReadStream(filePath);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line || line.trim().length === 0) continue;
    try {
      const card = JSON.parse(line);
      if (card && typeof card.lemma === "string") {
        cards.push(card);
      }
    } catch (error) {
      console.warn(`Skipping malformed JSONL line: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return cards;
}

function buildGapfillRows({ cards, level, limit, filterConfig }) {
  const rows = [];
  const seenPrompts = new Set();
  const stats = {
    emitted: 0,
    skippedNoExample: 0,
    skippedNoMatch: 0,
    droppedDuplicate: 0,
    droppedShort: 0,
    droppedLong: 0,
    filteredByGuards: 0,
  };
  const dropSummary = {};

  for (const card of cards) {
    if (!Array.isArray(card.examples) || card.examples.length === 0) {
      stats.skippedNoExample += 1;
      continue;
    }

    let cloze = null;
    for (const sentence of card.examples) {
      const attempt = attemptCloze(sentence, card.lemma);
      if (attempt && attempt.success) {
        cloze = attempt;
        break;
      }
      if (!cloze) {
        cloze = attempt;
      }
    }

    if (!cloze) {
      stats.skippedNoMatch += 1;
      continue;
    }

    if (!cloze || !cloze.success) {
      if (cloze && cloze.reason === "short") {
        stats.droppedShort += 1;
      } else if (cloze && cloze.reason === "long") {
        stats.droppedLong += 1;
      } else {
        stats.skippedNoMatch += 1;
      }
      continue;
    }

    const unsafeReason = checkUnsafeText(cloze.sentence ?? card.examples[0], filterConfig, dropSummary);
    if (unsafeReason) {
      stats.filteredByGuards += 1;
      continue;
    }

    const tokens = cloze.tokens ?? tokenizeSentence(cloze.sentence ?? card.examples[0]);
    let targetIndex = cloze.targetIndex ?? -1;
    if (targetIndex < 0) {
      const lowerAnswer = cloze.answer.toLowerCase();
      targetIndex = tokens.findIndex((token) => token.surface.toLowerCase() === lowerAnswer);
    }

    const surfaceReason = evaluateSurface({
      surface: cloze.answer,
      tokens,
      index: targetIndex >= 0 ? targetIndex : 0,
      sentence: cloze.sentence ?? card.examples[0],
      filterConfig,
      dropSummary,
    });
    if (surfaceReason) {
      stats.filteredByGuards += 1;
      continue;
    }

    const promptUnsafe = checkUnsafeText(cloze.prompt, filterConfig, dropSummary);
    if (promptUnsafe) {
      stats.filteredByGuards += 1;
      continue;
    }

    const normalized = normalizePrompt(cloze.prompt);
    if (seenPrompts.has(normalized)) {
      stats.droppedDuplicate += 1;
      continue;
    }

    seenPrompts.add(normalized);
    rows.push([
      level,
      "gapfill",
      cloze.prompt,
      cloze.answer,
      card.source ?? SOURCE_FALLBACK,
      card.license ?? LICENSE_FALLBACK,
    ]);
    stats.emitted += 1;
    if (limit && rows.length >= limit) break;
  }

  return { rows, stats, dropSummary };
}

function formatMatchingPair({ collocate, lemma, slot }) {
  const left = collocate;
  const right = lemma;
  return { left, right, slot };
}

function buildMatchingRows({ cards, level, limit, filterConfig }) {
  const rows = [];
  const seenRows = new Set();
  const stats = {
    emitted: 0,
    skippedNoPairs: 0,
    droppedDuplicate: 0,
    truncated: 0,
    filteredByGuards: 0,
  };
  const dropSummary = {};

  const lemmaBuckets = new Map();
  let cardsWithoutPairs = 0;

  for (const card of cards) {
    if (!card || typeof card.lemma !== "string" || typeof card.collocations !== "object" || card.collocations === null) {
      continue;
    }
    const lemma = card.lemma;
    const bucket = lemmaBuckets.get(lemma) ?? [];
    const seenValues = new Set(bucket.map((candidate) => candidate.value));
    for (const collocs of Object.values(card.collocations)) {
      if (!Array.isArray(collocs)) continue;
      for (const raw of collocs) {
        const value = raw?.trim();
        if (!value || seenValues.has(value)) continue;
        seenValues.add(value);
        bucket.push({ value, source: card.source ?? SOURCE_FALLBACK, license: card.license ?? LICENSE_FALLBACK });
      }
    }
    if (bucket.length > 0) {
      bucket.sort((a, b) => a.value.localeCompare(b.value));
      lemmaBuckets.set(lemma, bucket);
    } else {
      cardsWithoutPairs += 1;
    }
  }

  const lemmaList = Array.from(lemmaBuckets.keys()).sort((a, b) => a.localeCompare(b));
  if (lemmaList.length === 0) {
    return { rows, stats, dropSummary };
  }

  const lemmaIndices = new Map(lemmaList.map((lemma) => [lemma, 0]));
  const targetSetSize = Math.min(MATCHING_MAX_PAIRS, 6);
  let startOffset = 0;

  while (true) {
    const leftValues = [];
    const rightValues = [];
    const usedLemmas = new Set();
    let progress = false;

    for (let step = 0; step < lemmaList.length && leftValues.length < targetSetSize; step += 1) {
      const lemma = lemmaList[(startOffset + step) % lemmaList.length];
      const bucket = lemmaBuckets.get(lemma);
      if (!bucket || bucket.length === 0) continue;
      let idx = lemmaIndices.get(lemma) ?? 0;
      while (idx < bucket.length) {
        const candidate = bucket[idx];
        idx += 1;
        lemmaIndices.set(lemma, idx);
        const tokens = [
          { surface: "the", normalized: "the", index: 0 },
          { surface: candidate.value, normalized: normalizeToken(candidate.value), index: 1 },
          { surface: lemma, normalized: normalizeToken(lemma), index: 2 },
        ];
        const sentence = `the ${candidate.value} ${lemma}`;
        const surfaceReasonLeft = evaluateSurface({
          surface: candidate.value,
          tokens,
          index: 1,
          sentence,
          filterConfig,
          dropSummary,
        });
        if (surfaceReasonLeft) {
          stats.filteredByGuards += 1;
          continue;
        }
        const surfaceReasonRight = evaluateSurface({
          surface: lemma,
          tokens,
          index: 2,
          sentence,
          filterConfig,
          dropSummary,
        });
        if (surfaceReasonRight) {
          stats.filteredByGuards += 1;
          continue;
        }
        const unsafeReason = checkUnsafeText(sentence, filterConfig, dropSummary);
        if (unsafeReason) {
          stats.filteredByGuards += 1;
          continue;
        }
        leftValues.push(candidate.value);
        rightValues.push(lemma);
        usedLemmas.add(lemma);
        progress = true;
        break;
      }
      if (leftValues.length >= targetSetSize) break;
    }

    if (!progress) {
      break;
    }

    if (leftValues.length < MATCHING_MIN_PAIRS) {
      break;
    }

    const leftJoined = leftValues.join("|");
    const rightJoined = rightValues.join("|");
    const rowKey = `${normalizePrompt(leftJoined)}||${normalizePrompt(rightJoined)}`;
    if (seenRows.has(rowKey)) {
      stats.droppedDuplicate += 1;
    } else {
      seenRows.add(rowKey);
      rows.push([
        level,
        "matching",
        leftJoined,
        rightJoined,
        SOURCE_FALLBACK,
        LICENSE_FALLBACK,
        "",
      ]);
      stats.emitted += 1;
    }

    if (limit && rows.length >= limit) {
      break;
    }

    if (usedLemmas.size === 0) {
      break;
    }

    startOffset = (startOffset + usedLemmas.size) % lemmaList.length;
  }

  stats.skippedNoPairs = cardsWithoutPairs;

  return { rows, stats, dropSummary };
}

function isSimilarLemma(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length <= 3 || b.length <= 3) return false;
  return a.startsWith(b) || b.startsWith(a);
}

function selectDistractors(card, candidates, maxCandidates = 9) {
  const targetZipf = typeof card.freq_zipf === "number" ? card.freq_zipf : null;
  const filtered = candidates.filter((candidate) => {
    if (candidate.lemma === card.lemma) return false;
    if (isSimilarLemma(candidate.lemma, card.lemma)) return false;
    if (typeof candidate.freq_zipf !== "number" || targetZipf == null) {
      return true;
    }
    return Math.abs(candidate.freq_zipf - targetZipf) <= DISTRACTOR_TOLERANCE;
  });

  filtered.sort((a, b) => {
    if (targetZipf == null) {
      return a.lemma.localeCompare(b.lemma);
    }
    const diffA = typeof a.freq_zipf === "number" ? Math.abs(a.freq_zipf - targetZipf) : Number.POSITIVE_INFINITY;
    const diffB = typeof b.freq_zipf === "number" ? Math.abs(b.freq_zipf - targetZipf) : Number.POSITIVE_INFINITY;
    if (diffA === diffB) {
      return a.lemma.localeCompare(b.lemma);
    }
    return diffA - diffB;
  });

  const seen = new Set();
  const distractors = [];
  for (const candidate of filtered) {
    const lemma = candidate.lemma;
    if (!lemma) continue;
    const lower = lemma.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    distractors.push(lemma);
    if (distractors.length >= maxCandidates) break;
  }
  return distractors;
}

function buildMcqRows({ cards, limit, filterConfig }) {
  const rows = [];
  const seenPrompts = new Set();
  const stats = {
    emitted: 0,
    skippedNoExample: 0,
    skippedNoDistractors: 0,
    droppedDuplicate: 0,
    distractorCoverage: 0,
    attempted: 0,
    filteredByGuards: 0,
    nearDuplicateDrops: 0,
  };
  const dropSummary = {};

  const byPos = new Map();
  for (const card of cards) {
    if (!card || typeof card.pos !== "string") continue;
    const key = card.pos.toUpperCase();
    if (!byPos.has(key)) byPos.set(key, []);
    byPos.get(key).push(card);
  }

  for (const card of cards) {
    if (!Array.isArray(card.examples) || card.examples.length === 0) {
      stats.skippedNoExample += 1;
      continue;
    }

    let cloze = null;
    for (const sentence of card.examples) {
      const attempt = attemptCloze(sentence, card.lemma);
      if (attempt && attempt.success) {
        cloze = attempt;
        break;
      }
    }

    if (!cloze || !cloze.success) {
      stats.skippedNoExample += 1;
      continue;
    }

    const unsafeSentence = checkUnsafeText(cloze.sentence ?? card.examples[0], filterConfig, dropSummary);
    if (unsafeSentence) {
      stats.filteredByGuards += 1;
      continue;
    }

    const promptKey = normalizePrompt(cloze.prompt);
    if (seenPrompts.has(promptKey)) {
      stats.droppedDuplicate += 1;
      continue;
    }

    const tokens = cloze.tokens ?? tokenizeSentence(cloze.sentence ?? card.examples[0]);
    let targetIndex = cloze.targetIndex ?? -1;
    if (targetIndex < 0) {
      const lowerAnswer = cloze.answer.toLowerCase();
      targetIndex = tokens.findIndex((token) => token.surface.toLowerCase() === lowerAnswer);
    }

    const surfaceReason = evaluateSurface({
      surface: cloze.answer,
      tokens,
      index: targetIndex >= 0 ? targetIndex : 0,
      sentence: cloze.sentence ?? card.examples[0],
      filterConfig,
      dropSummary,
    });
    if (surfaceReason) {
      stats.filteredByGuards += 1;
      continue;
    }

    const promptUnsafe = checkUnsafeText(cloze.prompt, filterConfig, dropSummary);
    if (promptUnsafe) {
      stats.filteredByGuards += 1;
      continue;
    }

    stats.attempted += 1;
    const candidates = byPos.get(card.pos.toUpperCase()) ?? [];
    const distractorPool = selectDistractors(card, candidates);
    if (distractorPool.length < 3) {
      stats.skippedNoDistractors += 1;
      continue;
    }

    stats.distractorCoverage += 1;

    const combos = generateDistractorCombos(distractorPool);
    let selectedOptions = null;
    for (let comboIndex = 0; comboIndex < combos.length; comboIndex += 1) {
      const combo = combos[comboIndex];
      if (combo.length < 3) continue;
      const shuffled = deterministicShuffle(
        [cloze.answer, ...combo],
        `${card.lemma}|${cloze.prompt}|${comboIndex}`,
      );
      if (hasNearDuplicateOptions(shuffled, cloze.answer)) {
        continue;
      }
      selectedOptions = shuffled;
      break;
    }

    if (!selectedOptions) {
      stats.filteredByGuards += 1;
      stats.nearDuplicateDrops += 1;
      recordDrop(dropSummary, "nearDuplicate", cloze.prompt.slice(0, 160));
      continue;
    }

    const optionsUnsafe = checkUnsafeText(selectedOptions.join(" "), filterConfig, dropSummary);
    if (optionsUnsafe) {
      stats.filteredByGuards += 1;
      continue;
    }

    let dropOption = false;
    for (const option of selectedOptions) {
      if (isAcronym(option, filterConfig.acronymMinLen, filterConfig.allowlist)) {
        recordDrop(dropSummary, "acronym", option);
        dropOption = true;
        break;
      }
      if (checkUnsafeText(option, filterConfig, dropSummary)) {
        dropOption = true;
        break;
      }
    }

    if (dropOption) {
      stats.filteredByGuards += 1;
      continue;
    }

    rows.push([
      "mcq",
      cloze.prompt,
      selectedOptions.join("|"),
      cloze.answer,
      card.source ?? SOURCE_FALLBACK,
      card.license ?? LICENSE_FALLBACK,
    ]);
    seenPrompts.add(promptKey);
    stats.emitted += 1;
    if (limit && rows.length >= limit) break;
  }

  const coverage = stats.attempted === 0 ? 0 : Number(((stats.distractorCoverage / stats.attempted) * 100).toFixed(1));
  stats.distractorCoverage = coverage;

  return { rows, stats, dropSummary };
}

function csvEscape(value) {
  if (value == null) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function writeCsv(filePath, header, rows) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const bom = "\ufeff";
  const lines = [header.map(csvEscape).join(","), ...rows.map((row) => row.map(csvEscape).join(","))];
  await fs.writeFile(filePath, `${bom}${lines.join("\n")}\n`, "utf8");
}

function logSummary({ gapfill, matching, mcq, outputDir }, extras = {}) {
  const summary = {
    task: "cards-to-packs",
    outputDir,
    gapfill,
    matching,
    mcq,
  };
  Object.assign(summary, extras);
  console.log(JSON.stringify(summary, null, 2));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cardsPath = opts.get("--cards")
    ? path.resolve(opts.get("--cards"))
    : path.resolve(process.cwd(), "cards/draft_cards.jsonl");
  const level = opts.get("--level") ?? "A2";
  const outDir = opts.get("--outDir")
    ? path.resolve(opts.get("--outDir"))
    : path.resolve(process.cwd(), `public/packs/${level}`);

  const limitGapfill = toNumber(opts.get("--limitGapfill")) ?? 0;
  const limitMatching = toNumber(opts.get("--limitMatching")) ?? 0;
  const limitMcq = toNumber(opts.get("--limitMcq")) ?? 0;
  const sfwLevelRaw = opts.get("--sfwLevel") ? String(opts.get("--sfwLevel")).toLowerCase() : null;
  const sfwFlag = readBooleanOption(opts, "--sfw", true);
  let sfwLevel = sfwLevelRaw;
  let sfw = sfwFlag;
  if (sfwLevel) {
    if (sfwLevel === "off") {
      sfw = false;
    } else if (sfwLevel === "default" || sfwLevel === "strict") {
      sfw = true;
    } else {
      sfwLevel = "default";
      sfw = true;
    }
  } else {
    sfwLevel = sfw ? "default" : "off";
  }
  const dropProperNouns = readBooleanOption(opts, "--dropProperNouns", true);
  const acronymMinLen = toNumber(opts.get("--acronymMinLen")) ?? 3;
  const blockListPath = readPathOption(opts, "--blockList");
  const allowListPath = readPathOption(opts, "--allowList");
  const properListPath = readPathOption(opts, "--properList");
  const nationalitiesPath = readPathOption(opts, "--nationalities");
  const sfwAllowPath = readPathOption(opts, "--sfwAllow");

  const filterConfig = await buildFilterConfig({
    cwd: process.cwd(),
    blockListPath,
    allowListPath,
    properListPath,
    nationalitiesPath,
    acronymMinLen,
    dropProperNouns,
    sfw,
    sfwLevel,
    sfwAllowPath,
  });

  console.log(
    JSON.stringify(
      {
        task: "cards-to-packs:init",
        cardsPath,
        level,
        outDir,
        limitGapfill: limitGapfill || null,
        limitMatching: limitMatching || null,
        limitMcq: limitMcq || null,
        sfw,
        sfwLevel,
        dropProperNouns,
        acronymMinLen,
      },
      null,
      2,
    ),
  );

  const cards = await loadCards(cardsPath);

  const combinedDropSummary = {};

  const gapfill = buildGapfillRows({ cards, level, limit: limitGapfill, filterConfig });
  mergeDropSummaries(combinedDropSummary, gapfill.dropSummary);
  await writeCsv(
    path.join(outDir, "gapfill.csv"),
    ["level", "type", "prompt", "answer", "source", "license"],
    gapfill.rows,
  );

  const matching = buildMatchingRows({ cards, level, limit: limitMatching, filterConfig });
  mergeDropSummaries(combinedDropSummary, matching.dropSummary);
  await writeCsv(
    path.join(outDir, "matching.csv"),
    ["level", "type", "left", "right", "source", "license", "count"],
    matching.rows,
  );

  const mcq = buildMcqRows({ cards, limit: limitMcq, filterConfig });
  mergeDropSummaries(combinedDropSummary, mcq.dropSummary);
  await writeCsv(
    path.join(outDir, "mcq.csv"),
    ["type", "prompt", "options", "answer", "source", "license"],
    mcq.rows,
  );

  const summaryExtras = buildSummaryFragment(combinedDropSummary);
  summaryExtras.sfwLevel = filterConfig.sfwLevel;

  logSummary({
    gapfill: gapfill.stats,
    matching: matching.stats,
    mcq: mcq.stats,
    outputDir: outDir,
  }, summaryExtras);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
