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
  if (!filterConfig.sfw) return null;
  if (!text) return null;
  if (isUnsafe(text, filterConfig.blocklist, true)) {
    recordDrop(dropSummary, "unsafe", text.slice(0, 160));
    return "unsafe";
  }
  return null;
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

  for (const card of cards) {
    if (!card || typeof card.lemma !== "string" || typeof card.collocations !== "object" || card.collocations === null) {
      stats.skippedNoPairs += 1;
      continue;
    }
    const pairs = [];
    const pairKeys = new Set();
    for (const [slot, collocs] of Object.entries(card.collocations)) {
      if (!Array.isArray(collocs)) continue;
      collocs.forEach((collocate) => {
        if (!collocate || collocate.trim().length === 0) return;
        const pair = formatMatchingPair({ collocate: collocate.trim(), lemma: card.lemma, slot });
        const key = normalizePair(pair.left, pair.right);
        if (pairKeys.has(key)) return;

        const sentence = `the ${pair.left} ${pair.right}`;
        const tokens = [
          { surface: "the", normalized: "the", index: 0 },
          { surface: pair.left, normalized: pair.left.toLowerCase().replace(/[^a-z]+/g, ""), index: 1 },
          { surface: pair.right, normalized: pair.right.toLowerCase().replace(/[^a-z]+/g, ""), index: 2 },
        ];
        const leftReason = evaluateSurface({
          surface: pair.left,
          tokens,
          index: 1,
          sentence,
          filterConfig,
          dropSummary,
        });
        if (leftReason) {
          stats.filteredByGuards += 1;
          return;
        }

        const rightReason = evaluateSurface({
          surface: pair.right,
          tokens,
          index: 2,
          sentence,
          filterConfig,
          dropSummary,
        });
        if (rightReason) {
          stats.filteredByGuards += 1;
          return;
        }

        const unsafeReason = checkUnsafeText(sentence, filterConfig, dropSummary);
        if (unsafeReason) {
          stats.filteredByGuards += 1;
          return;
        }

        pairKeys.add(key);
        pairs.push(pair);
      });
    }

    if (pairs.length < MATCHING_MIN_PAIRS) {
      stats.skippedNoPairs += 1;
      continue;
    }

    if (pairs.length > MATCHING_MAX_PAIRS) {
      pairs.length = MATCHING_MAX_PAIRS;
      stats.truncated += 1;
    }

    const leftValues = pairs.map((pair) => pair.left).join("|");
    const rightValues = pairs.map((pair) => pair.right).join("|");
    const rowKey = `${normalizePrompt(leftValues)}||${normalizePrompt(rightValues)}`;
    if (seenRows.has(rowKey)) {
      stats.droppedDuplicate += 1;
      continue;
    }
    seenRows.add(rowKey);

    rows.push([
      level,
      "matching",
      leftValues,
      rightValues,
      card.source ?? SOURCE_FALLBACK,
      card.license ?? LICENSE_FALLBACK,
      "",
    ]);
    stats.emitted += 1;
    if (limit && rows.length >= limit) break;
  }

  return { rows, stats, dropSummary };
}

function isSimilarLemma(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length <= 3 || b.length <= 3) return false;
  return a.startsWith(b) || b.startsWith(a);
}

function selectDistractors(card, candidates) {
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
    if (!lemma || seen.has(lemma.toLowerCase())) continue;
    seen.add(lemma.toLowerCase());
    distractors.push(lemma);
    if (distractors.length >= 3) break;
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
    const distractors = selectDistractors(card, candidates);
    if (distractors.length < 3) {
      stats.skippedNoDistractors += 1;
      continue;
    }

    stats.distractorCoverage += 1;

    const options = deterministicShuffle([cloze.answer, ...distractors], `${card.lemma}|${cloze.prompt}`);

    const optionsUnsafe = checkUnsafeText(options.join(" "), filterConfig, dropSummary);
    if (optionsUnsafe) {
      stats.filteredByGuards += 1;
      continue;
    }

    let dropOption = false;
    for (const option of options) {
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
      options.join("|"),
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
  const sfw = readBooleanOption(opts, "--sfw", true);
  const dropProperNouns = readBooleanOption(opts, "--dropProperNouns", true);
  const acronymMinLen = toNumber(opts.get("--acronymMinLen")) ?? 3;
  const blockListPath = readPathOption(opts, "--blockList");
  const allowListPath = readPathOption(opts, "--allowList");
  const properListPath = readPathOption(opts, "--properList");
  const nationalitiesPath = readPathOption(opts, "--nationalities");

  const filterConfig = await buildFilterConfig({
    cwd: process.cwd(),
    blockListPath,
    allowListPath,
    properListPath,
    nationalitiesPath,
    acronymMinLen,
    dropProperNouns,
    sfw,
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
