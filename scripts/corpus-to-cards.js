#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createGunzip } from "node:zlib";
import {
  buildFilterConfig,
  tokenizeSentence,
  isProperNounLike,
  isUnsafe,
  isAcronym,
  isTooShortAnswer,
  recordDrop,
  buildSummaryFragment,
  lemmaCaseShare,
  dominantProperNoun,
  isOrdinal,
  resolveSurfacePos,
  isFormulaArtifact,
} from "./filter-utils.js";

const ALLOWED_POS = new Set(["NOUN", "VERB", "ADJ", "ADV"]);
const DEFAULT_LEVEL = "A2";
const SOURCE = "simplewiki";
const LICENSE = "CC BY-SA";
const SURFACE_FORM_PATTERN = /^[a-z][a-z'\u2019-]{0,31}$/i;

function readBooleanOption(options, key, defaultValue) {
  if (!options.has(key)) {
    return defaultValue;
  }
  const raw = options.get(key);
  if (raw === "" || raw == null) {
    return true;
  }
  const lower = String(raw).toLowerCase();
  if (["false", "off", "0", "no"].includes(lower)) {
    return false;
  }
  if (["true", "on", "1", "yes"].includes(lower)) {
    return true;
  }
  return defaultValue;
}

function readPathOption(options, key) {
  if (!options.has(key)) return null;
  const value = options.get(key);
  if (!value) return null;
  return value;
}

function toNumber(value) {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeLemma(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizePos(raw) {
  if (!raw) return "";
  const upper = String(raw).trim().toUpperCase();
  if (upper === "ADJECTIVE" || upper === "ADJ") return "ADJ";
  if (upper === "VERB" || upper === "VB" || upper === "V") return "VERB";
  if (upper === "NOUN" || upper === "NN" || upper === "N") return "NOUN";
  if (upper === "ADVERB" || upper === "ADV" || upper === "RB") return "ADV";
  return upper;
}

function normalizeSurfaceForm(value) {
  if (!value) return "";
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return "";
  if (!SURFACE_FORM_PATTERN.test(normalized)) {
    return "";
  }
  return normalized;
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
      return values.map((value) => value.trim());
    },
  };
}

async function* readCsvRecords(filePath) {
  const parser = buildCsvParser();
  const stream = filePath.endsWith(".gz")
    ? createReadStream(filePath).pipe(createGunzip())
    : createReadStream(filePath);

  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let headers = null;
  let headerLookup = null;

  for await (const line of rl) {
    if (!headers) {
      headers = parser.parseLine(line);
      headerLookup = headers.map((header) => header.toLowerCase());
      continue;
    }
    if (line.trim().length === 0) continue;
    const values = parser.parseLine(line);
    const row = {};
    for (let i = 0; i < headerLookup.length; i += 1) {
      row[headerLookup[i]] = values[i] ?? "";
    }
    yield row;
  }
}

function pick(row, candidates) {
  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      return row[key];
    }
  }
  return "";
}

async function collectFreqStats({ filePath, limit }) {
  let totalTokens = 0;
  const lemmas = new Map();
  let collected = 0;

  try {
    await fs.access(filePath);
  } catch (error) {
    return { totalTokens: 0, lemmas };
  }

  for await (const row of readCsvRecords(filePath)) {
    const rawLemma = pick(row, ["lemma", "token", "word"]);
    const lemma = normalizeLemma(rawLemma);
    if (!lemma) continue;

    const countValue = pick(row, ["count", "freq", "total", "frequency"]);
    const count = toNumber(countValue);
    if (count) {
      totalTokens += count;
    }

    if (limit && collected >= limit && !lemmas.has(lemma)) {
      continue;
    }

    let entry = lemmas.get(lemma);
    if (!entry) {
      if (limit && collected >= limit) {
        continue;
      }
      entry = {
        lemma,
        count: count ?? 0,
        posCounts: new Map(),
        posEvidence: new Map(),
        examples: new Map(),
        forms: new Set([lemma]),
        rawPosCounts: new Map(),
        caseStats: { lower: 0, capital: 0, upper: 0 },
        collocationBuckets: {
          adjForNoun: new Map(),
          nounForVerb: new Map(),
          nounForAdj: new Map(),
          verbForAdv: new Map(),
          adjForAdv: new Map(),
        },
      };
      lemmas.set(lemma, entry);
      collected += 1;
    } else if (count) {
      entry.count = count;
    }

    const posHint = normalizePos(pick(row, ["pos", "upos", "tag"]));
    if (ALLOWED_POS.has(posHint)) {
      entry.posCounts.set(posHint, (entry.posCounts.get(posHint) ?? 0) + (count ?? 1));
    }
  }

  return { totalTokens, lemmas };
}

async function collectTokenData({ filePath, lemmas }) {
  if (!filePath) {
    return { formIndex: null, lemmasWithForms: 0, formsIndexed: 0, surfacePosCounts: new Map() };
  }
  try {
    await fs.access(filePath);
  } catch (error) {
    return { formIndex: null, lemmasWithForms: 0, formsIndexed: 0, surfacePosCounts: new Map() };
  }

  const tracked = new Set(lemmas.keys());
  if (tracked.size === 0) {
    return { formIndex: null, lemmasWithForms: 0, formsIndexed: 0, surfacePosCounts: new Map() };
  }

  const surfacePosCounts = new Map();

  function bumpSurfacePos(surface, pos, weight) {
    if (!surface || !pos) return;
    let posCounts = surfacePosCounts.get(surface);
    if (!posCounts) {
      posCounts = new Map();
      surfacePosCounts.set(surface, posCounts);
    }
    posCounts.set(pos, (posCounts.get(pos) ?? 0) + weight);
  }

  for await (const row of readCsvRecords(filePath)) {
    const rawLemma = pick(row, ["lemma", "token", "word", "lemma_lower"]);
    const lemma = normalizeLemma(rawLemma);
    if (!tracked.has(lemma)) continue;
    const entry = lemmas.get(lemma);
    if (!entry) continue;

    const weightValue = pick(row, ["count", "freq", "frequency", "token_count"]);
    const weight = toNumber(weightValue) ?? 1;
    const pos = normalizePos(pick(row, ["upos", "pos", "xpos", "tag"]));
    if (pos) {
      entry.rawPosCounts.set(pos, (entry.rawPosCounts.get(pos) ?? 0) + weight);
    }
    const surfaceOriginal = pick(row, ["token", "word", "surface", "text"]);
    const surface = normalizeSurfaceForm(surfaceOriginal);

    if (surfaceOriginal) {
      const trimmed = String(surfaceOriginal).trim();
      if (trimmed === trimmed.toLowerCase()) {
        entry.caseStats.lower += weight;
      } else if (trimmed === trimmed.toUpperCase()) {
        entry.caseStats.upper += weight;
      } else if (/^[A-Z]/.test(trimmed)) {
        entry.caseStats.capital += weight;
      }
    }

    if (ALLOWED_POS.has(pos)) {
      entry.posCounts.set(pos, (entry.posCounts.get(pos) ?? 0) + weight);
      recordPosEvidence(entry, pos, weight);
      if (surface) {
        entry.forms.add(surface);
        bumpSurfacePos(surface, pos, weight);
      }
      continue;
    }

    if (surface) {
      entry.forms.add(surface);
      if (pos) {
        bumpSurfacePos(surface, pos, weight);
      }
    }
  }

  const formIndex = new Map();
  let lemmasWithForms = 0;

  for (const entry of lemmas.values()) {
    if (!entry.forms) continue;
    if (entry.forms.size > 1) {
      lemmasWithForms += 1;
    }
    for (const form of entry.forms) {
      if (!form) continue;
      let bucket = formIndex.get(form);
      if (!bucket) {
        bucket = [];
        formIndex.set(form, bucket);
      }
      bucket.push(entry);
    }
  }

  for (const bucket of formIndex.values()) {
    bucket.sort((a, b) => a.lemma.localeCompare(b.lemma));
  }

  return { formIndex, lemmasWithForms, formsIndexed: formIndex.size, surfacePosCounts };
}

function recordPosEvidence(entry, pos, weight) {
  if (!ALLOWED_POS.has(pos)) return;
  entry.posEvidence.set(pos, (entry.posEvidence.get(pos) ?? 0) + weight);
}

function recordCollocation(bucket, key, weight) {
  if (!key) return;
  const current = bucket.get(key) ?? { count: 0 };
  current.count += weight;
  bucket.set(key, current);
}

async function collectBigrams({ filePath, lemmas, minColloc, formIndex, surfacePosCounts }) {
  try {
    await fs.access(filePath);
  } catch (error) {
    return;
  }

  const tracked = new Set(lemmas.keys());
  if (tracked.size === 0) return;

  for await (const row of readCsvRecords(filePath)) {
    let lemma1 = normalizeLemma(pick(row, ["lemma1", "left_lemma", "w1", "token1", "left"]));
    let lemma2 = normalizeLemma(pick(row, ["lemma2", "right_lemma", "w2", "token2", "right"]));

    let token1 = normalizeSurfaceForm(pick(row, ["token1", "w1", "left_token", "left"]));
    let token2 = normalizeSurfaceForm(pick(row, ["token2", "w2", "right_token", "right"]));
    const ngramRaw = pick(row, ["ngram", "text", "pair"]);
    if ((!token1 || !token2) && ngramRaw) {
      const parts = ngramRaw
        .split(/\s+/)
        .map((part) => normalizeSurfaceForm(part))
        .filter((part) => part);
      if (parts.length >= 2) {
        if (!token1) token1 = parts[0];
        if (!token2) token2 = parts[1];
      }
    }

    const leftEntries = [];
    const rightEntries = [];
    const leftSeen = new Set();
    const rightSeen = new Set();

    if (lemma1 && lemmas.has(lemma1)) {
      const entry = lemmas.get(lemma1);
      leftEntries.push(entry);
      leftSeen.add(entry);
    }
    if (!lemma1 && token1 && formIndex?.has(token1)) {
      for (const entry of formIndex.get(token1)) {
        if (!leftSeen.has(entry)) {
          leftEntries.push(entry);
          leftSeen.add(entry);
        }
      }
    }

    if (lemma2 && lemmas.has(lemma2)) {
      const entry = lemmas.get(lemma2);
      rightEntries.push(entry);
      rightSeen.add(entry);
    }
    if (!lemma2 && token2 && formIndex?.has(token2)) {
      for (const entry of formIndex.get(token2)) {
        if (!rightSeen.has(entry)) {
          rightEntries.push(entry);
          rightSeen.add(entry);
        }
      }
    }

    if (leftEntries.length === 0 && rightEntries.length === 0) {
      continue;
    }

    let pos1 = normalizePos(pick(row, ["pos1", "upos1", "xpos1", "left_pos"]));
    let pos2 = normalizePos(pick(row, ["pos2", "upos2", "xpos2", "right_pos"]));
    if (!ALLOWED_POS.has(pos1)) pos1 = resolveSurfacePos(token1, surfacePosCounts);
    if (!ALLOWED_POS.has(pos2)) pos2 = resolveSurfacePos(token2, surfacePosCounts);

    const count = toNumber(pick(row, ["count", "freq", "frequency", "total", "bigram_count"])) ?? 0;

    const leftCollocStrings = leftEntries.length > 0
      ? Array.from(new Set(leftEntries.map((entry) => entry.lemma)))
      : token1
        ? [token1]
        : [];
    const rightCollocStrings = rightEntries.length > 0
      ? Array.from(new Set(rightEntries.map((entry) => entry.lemma)))
      : token2
        ? [token2]
        : [];

    if (count < minColloc) {
      for (const entry of leftEntries) {
        recordPosEvidence(entry, pos1, count);
      }
      for (const entry of rightEntries) {
        recordPosEvidence(entry, pos2, count);
      }
      continue;
    }

    for (const entry of rightEntries) {
      recordPosEvidence(entry, pos2, count);
      if (pos1 === "ADJ" && pos2 === "NOUN") {
        for (const value of leftCollocStrings) {
          recordCollocation(entry.collocationBuckets.adjForNoun, value, count);
        }
      }
      if (pos1 === "VERB" && pos2 === "ADV") {
        for (const value of leftCollocStrings) {
          recordCollocation(entry.collocationBuckets.verbForAdv, value, count);
        }
      }
      if (pos1 === "ADV" && pos2 === "ADJ") {
        for (const value of leftCollocStrings) {
          recordCollocation(entry.collocationBuckets.adjForAdv, value, count);
        }
      }
    }

    for (const entry of leftEntries) {
      recordPosEvidence(entry, pos1, count);
      if (pos1 === "VERB" && pos2 === "NOUN") {
        for (const value of rightCollocStrings) {
          recordCollocation(entry.collocationBuckets.nounForVerb, value, count);
        }
      }
      if (pos1 === "ADJ" && pos2 === "NOUN") {
        for (const value of rightCollocStrings) {
          recordCollocation(entry.collocationBuckets.nounForAdj, value, count);
        }
      }
      if (pos1 === "ADV" && pos2 === "ADJ") {
        for (const value of rightCollocStrings) {
          recordCollocation(entry.collocationBuckets.adjForAdv, value, count);
        }
      }
    }
  }
}

function normalizeSentence(sentence) {
  return sentence.trim().replace(/\s+/g, " ");
}

function isSentenceEligible(sentence) {
  const length = sentence.length;
  return length >= 40 && length <= 120;
}

async function collectExamples({ filePath, lemmas, maxExamples, formIndex, filterConfig, dropSummary }) {
  try {
    await fs.access(filePath);
  } catch (error) {
    return { exampleMatchesTried: 0 };
  }

  const tracked = new Set(lemmas.keys());
  if (tracked.size === 0) return { exampleMatchesTried: 0 };

  const stream = createReadStream(filePath);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const usingSurfaceForms = formIndex instanceof Map && formIndex.size > 0;
  let exampleMatchesAccepted = 0;

  for await (const rawLine of rl) {
    const sentence = normalizeSentence(rawLine);
    if (!isSentenceEligible(sentence)) continue;
    if (isUnsafe(sentence, filterConfig.sfwPatterns, filterConfig.sfwAllowPatterns)) {
      recordDrop(dropSummary, "sfw", sentence.slice(0, 160));
      continue;
    }

    const tokens = tokenizeSentence(sentence);
    if (tokens.length === 0) continue;
    const sentenceKey = sentence.toLowerCase();

    for (let i = 0; i < tokens.length; i += 1) {
      const tokenInfo = tokens[i];
      const normalized = tokenInfo.normalized;
      if (!normalized) continue;
      let candidates = [];
      if (usingSurfaceForms) {
        const bucket = formIndex.get(normalized);
        if (bucket) {
          candidates = bucket;
        }
      } else if (lemmas.has(normalized)) {
        candidates = [lemmas.get(normalized)];
      }

      if (candidates.length === 0) continue;

      for (const entry of candidates) {
        if (!entry) continue;
        if (entry.examples.size >= maxExamples) continue;
        if (entry.examples.has(sentenceKey)) continue;

        if (
          isAcronym(tokenInfo.surface, filterConfig.acronymMinLen, filterConfig.allowlist)
        ) {
          recordDrop(
            dropSummary,
            "acronym",
            `${tokenInfo.surface} :: ${sentence.slice(0, 120)}`,
          );
          continue;
        }

        if (isFormulaArtifact(tokenInfo.surface)) {
          recordDrop(
            dropSummary,
            "formula",
            `${tokenInfo.surface} :: ${sentence.slice(0, 120)}`,
          );
          continue;
        }

        const proper = isProperNounLike({
          entry,
          surface: tokenInfo.surface,
          tokens,
          index: i,
          sentenceInitial: i === 0,
          properSet: filterConfig.properContext,
          nationalitySet: filterConfig.nationalities,
          config: filterConfig,
        });
        if (proper) {
          recordDrop(
            dropSummary,
            "proper",
            `${tokenInfo.surface} :: ${sentence.slice(0, 120)}`,
          );
          continue;
        }

        entry.examples.set(sentenceKey, sentence);
        exampleMatchesAccepted += 1;
      }
    }
  }

  return { exampleMatchesTried: exampleMatchesAccepted };
}

function pickPos(entry) {
  let bestPos = "";
  let bestScore = -Infinity;

  const combined = new Map();
  for (const [pos, count] of entry.posCounts.entries()) {
    combined.set(pos, (combined.get(pos) ?? 0) + count);
  }
  for (const [pos, count] of entry.posEvidence.entries()) {
    combined.set(pos, (combined.get(pos) ?? 0) + count * 0.5);
  }

  if (combined.size === 0) {
    return "NOUN";
  }

  for (const [pos, score] of combined.entries()) {
    if (!ALLOWED_POS.has(pos)) continue;
    if (score > bestScore) {
      bestPos = pos;
      bestScore = score;
    }
  }

  return bestPos || "NOUN";
}

function finalizeExamples(entry) {
  const sentences = Array.from(entry.examples.values());
  sentences.sort((a, b) => {
    const target = 80;
    const scoreA = Math.abs(a.length - target);
    const scoreB = Math.abs(b.length - target);
    if (scoreA === scoreB) {
      return a.localeCompare(b);
    }
    return scoreA - scoreB;
  });
  return sentences.slice(0, entry.examples.size);
}

function finalizeCollocations(entry, pos, limits) {
  const results = [];
  const { min, max } = limits;

  const addCandidates = (bucket, slot) => {
    const candidates = sortBucket(bucket, max);
    if (candidates.length >= min) {
      candidates.forEach((candidate) => {
        if (!candidate || !candidate.partner) return;
        results.push({
          anchor: entry.lemma,
          partner: candidate.partner,
          score: candidate.score,
          slot,
        });
      });
    }
  };

  if (pos === "NOUN") {
    addCandidates(entry.collocationBuckets.adjForNoun, "ADJ");
  } else if (pos === "VERB") {
    addCandidates(entry.collocationBuckets.nounForVerb, "NOUN");
  } else if (pos === "ADJ") {
    addCandidates(entry.collocationBuckets.nounForAdj, "NOUN");
  } else if (pos === "ADV") {
    addCandidates(entry.collocationBuckets.verbForAdv, "VERB");
    addCandidates(entry.collocationBuckets.adjForAdv, "ADJ");
  }

  return results;
}

function sortBucket(bucket, max) {
  if (!bucket) return [];
  return Array.from(bucket.entries())
    .sort((a, b) => {
      if (b[1].count === a[1].count) {
        return a[0].localeCompare(b[0]);
      }
      return b[1].count - a[1].count;
    })
    .map(([key, value]) => ({ partner: key, score: value?.count ?? value ?? 0 }))
    .filter((entry) => entry.partner)
    .slice(0, max);
}

function computeZipf(count, totalTokens) {
  if (!count || !totalTokens) return null;
  const ratio = count / totalTokens;
  if (ratio <= 0) return null;
  return Number((Math.log10(ratio) + 6).toFixed(4));
}

function chooseSamples(cards, maxSamples) {
  if (cards.length === 0) return [];
  if (cards.length <= maxSamples) return cards;
  const result = [];
  for (let i = 0; i < maxSamples; i += 1) {
    const ratio = maxSamples === 1 ? 0 : i / (maxSamples - 1);
    const index = Math.round(ratio * (cards.length - 1));
    if (result.length > 0 && result[result.length - 1] === cards[index]) {
      continue;
    }
    result.push(cards[index]);
  }
  return result;
}

async function writeJsonl(filePath, cards) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const content = cards.map((card) => JSON.stringify(card)).join("\n");
  await fs.writeFile(filePath, `${content}\n`, "utf8");
}

function logSummary({
  lemmasSeen,
  cards,
  totalExamples,
  cardsWithExamples,
  totalCollocations,
  cardsWithCollocations,
  posCounts,
  missingFreq,
  lemmasWithForms,
  formsIndexed,
  exampleMatchesTried,
}, extras = {}) {
  const summary = {
    lemmasSeen,
    cardsEmitted: cards.length,
    withExamples: cardsWithExamples,
    avgExamplesPerCard: cards.length ? Number((totalExamples / cards.length).toFixed(2)) : 0,
    withCollocations: cardsWithCollocations,
    avgCollocsPerCard: cards.length ? Number((totalCollocations / cards.length).toFixed(2)) : 0,
    posBreakdown: posCounts,
    missingFreq,
    lemmasWithForms,
    formsIndexed,
    exampleMatchesTried,
  };
  Object.assign(summary, extras);
  console.log(JSON.stringify(summary, null, 2));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const level = opts.get("--level") || DEFAULT_LEVEL;
  const limit = toNumber(opts.get("--limit")) ?? 0;
  const maxExamples = Math.max(1, toNumber(opts.get("--maxExamples")) ?? 3);
  const minColloc = Math.max(1, toNumber(opts.get("--minColloc")) ?? 5);
  const maxColloc = Math.max(minColloc, toNumber(opts.get("--maxColloc")) ?? 8);
  const showSamples = opts.has("--showSamples");
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

  const freqPath = opts.get("--freq")
    ? path.resolve(opts.get("--freq"))
    : path.resolve(process.cwd(), ".codex-local/corpus/simplewiki/data/freq_lemmas.csv");
  const bigramPath = opts.get("--bigrams")
    ? path.resolve(opts.get("--bigrams"))
    : path.resolve(process.cwd(), ".codex-local/corpus/simplewiki/data/bigrams.csv");
  const sentencesPath = opts.get("--sentences")
    ? path.resolve(opts.get("--sentences"))
    : path.resolve(process.cwd(), `.codex-local/corpus/simplewiki/clean/sentences_${level}.txt`);
  const tokensPath = opts.get("--tokens") ? path.resolve(opts.get("--tokens")) : null;
  const outputPath = opts.get("--out")
    ? path.resolve(opts.get("--out"))
    : path.resolve(process.cwd(), "cards/draft_cards.jsonl");

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
        task: "corpus-to-cards",
        level,
        freqPath,
        bigramPath,
        sentencesPath,
        tokensPath: tokensPath ?? null,
        outputPath,
        limit: limit || null,
        maxExamples,
        minColloc,
        maxColloc,
        sfw,
        sfwLevel,
        dropProperNouns,
        acronymMinLen,
      },
      null,
      2,
    ),
  );

  const { totalTokens, lemmas } = await collectFreqStats({ filePath: freqPath, limit });
  const lemmasSeen = lemmas.size;
  const dropSummary = {};

  const { formIndex, lemmasWithForms, formsIndexed, surfacePosCounts } = await collectTokenData({
    filePath: tokensPath,
    lemmas,
  });
  if (formIndex && formIndex.size > 0 && lemmasWithForms > 0) {
    console.log("Using surface-form matching via tokens corpus (tokens.csv[.gz]).");
  }
  await collectBigrams({
    filePath: bigramPath,
    lemmas,
    minColloc,
    formIndex,
    surfacePosCounts,
  });
  const { exampleMatchesTried } = await collectExamples({
    filePath: sentencesPath,
    lemmas,
    maxExamples,
    formIndex,
    filterConfig,
    dropSummary,
  });

  const cards = [];
  let totalExamples = 0;
  let cardsWithExamples = 0;
  let totalCollocations = 0;
  let cardsWithCollocations = 0;
  const posCounts = {};
  let missingFreq = 0;

  for (const entry of lemmas.values()) {
    const pos = pickPos(entry);
    if (!ALLOWED_POS.has(pos)) {
      continue;
    }

    const examples = finalizeExamples(entry).slice(0, maxExamples);
    const collocations = finalizeCollocations(entry, pos, { min: 2, max: maxColloc });

    if (filterConfig.dropProperNouns) {
      if (dominantProperNoun(entry)) {
        recordDrop(dropSummary, "proper", entry.lemma);
        continue;
      }
      const lowerShare = lemmaCaseShare(entry);
      if (lowerShare > 0 && lowerShare < 0.6) {
        recordDrop(dropSummary, "proper", entry.lemma);
        continue;
      }
      if (isOrdinal(entry.lemma)) {
        recordDrop(dropSummary, "ordinal", entry.lemma);
        continue;
      }
    }

    if (isAcronym(entry.lemma, filterConfig.acronymMinLen, filterConfig.allowlist)) {
      recordDrop(dropSummary, "acronym", entry.lemma);
      continue;
    }

    if (isFormulaArtifact(entry.lemma)) {
      recordDrop(dropSummary, "formula", entry.lemma);
      continue;
    }

    if (isTooShortAnswer(entry.lemma)) {
      recordDrop(dropSummary, "length", entry.lemma);
      continue;
    }

    if (
      examples.some((example) => isUnsafe(example, filterConfig.sfwPatterns, filterConfig.sfwAllowPatterns))
    ) {
      recordDrop(
        dropSummary,
        "sfw",
        `${entry.lemma} :: ${examples[0]?.slice(0, 120) ?? ""}`,
      );
      continue;
    }

    if (
      examples.some((example) => example && example.toLowerCase().includes("formula_"))
    ) {
      recordDrop(dropSummary, "formula", `${entry.lemma}`);
      continue;
    }

    const collocEntries = Array.isArray(collocations)
      ? collocations.filter((entry) =>
          entry && typeof entry.partner === "string"
            ? !isAcronym(entry.partner, filterConfig.acronymMinLen, filterConfig.allowlist)
            : false,
        )
      : [];

    const collocCount = collocEntries.length;

    if (examples.length === 0 || collocCount < 2) {
      continue;
    }

    const freqZipf = computeZipf(entry.count, totalTokens);
    if (freqZipf == null) missingFreq += 1;

    const card = {
      lemma: entry.lemma,
      pos,
      freq_zipf: freqZipf,
      examples,
      collocations: collocEntries,
      distractors: Array.isArray(entry.distractors) ? entry.distractors : [],
      flags: {},
      source: SOURCE,
      license: LICENSE,
    };

    cards.push(card);

    if (examples.length > 0) {
      cardsWithExamples += 1;
      totalExamples += examples.length;
    }

    if (collocCount > 0) {
      cardsWithCollocations += 1;
      totalCollocations += collocCount;
    }

    posCounts[pos] = (posCounts[pos] ?? 0) + 1;
  }

  cards.sort((a, b) => a.lemma.localeCompare(b.lemma));

  await writeJsonl(outputPath, cards);

  const summaryExtras = buildSummaryFragment(dropSummary);
  summaryExtras.sfwLevel = filterConfig.sfwLevel;

  logSummary({
    lemmasSeen,
    cards,
    totalExamples,
    cardsWithExamples,
    totalCollocations,
    cardsWithCollocations,
    posCounts,
    missingFreq,
    lemmasWithForms,
    formsIndexed,
    exampleMatchesTried,
  }, summaryExtras);

  if (showSamples) {
    const samples = chooseSamples(cards, 5);
    samples.forEach((card, index) => {
      console.log(`sample[${index}]`, JSON.stringify(card, null, 2));
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
