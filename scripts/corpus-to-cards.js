#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createGunzip } from "node:zlib";

const ALLOWED_POS = new Set(["NOUN", "VERB", "ADJ", "ADV"]);
const DEFAULT_LEVEL = "A2";
const SOURCE = "simplewiki";
const LICENSE = "CC BY-SA";

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

async function collectTokenPos({ filePath, lemmas }) {
  if (!filePath) return;
  try {
    await fs.access(filePath);
  } catch (error) {
    return;
  }

  const tracked = new Set(lemmas.keys());
  if (tracked.size === 0) return;

  for await (const row of readCsvRecords(filePath)) {
    const rawLemma = pick(row, ["lemma", "token", "word", "lemma_lower"]);
    const lemma = normalizeLemma(rawLemma);
    if (!tracked.has(lemma)) continue;
    const pos = normalizePos(pick(row, ["upos", "pos", "xpos", "tag"]));
    if (!ALLOWED_POS.has(pos)) continue;
    const entry = lemmas.get(lemma);
    const weightValue = pick(row, ["count", "freq", "frequency", "token_count"]);
    const weight = toNumber(weightValue) ?? 1;
    entry.posCounts.set(pos, (entry.posCounts.get(pos) ?? 0) + weight);
  }
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

async function collectBigrams({ filePath, lemmas, minColloc }) {
  try {
    await fs.access(filePath);
  } catch (error) {
    return;
  }

  const tracked = new Set(lemmas.keys());
  if (tracked.size === 0) return;

  for await (const row of readCsvRecords(filePath)) {
    const lemma1 = normalizeLemma(pick(row, ["lemma1", "left_lemma", "w1", "token1", "left"]));
    const lemma2 = normalizeLemma(pick(row, ["lemma2", "right_lemma", "w2", "token2", "right"]));
    if (!lemma1 && !lemma2) continue;

    const pos1 = normalizePos(pick(row, ["pos1", "upos1", "xpos1", "left_pos"]));
    const pos2 = normalizePos(pick(row, ["pos2", "upos2", "xpos2", "right_pos"]));
    const count = toNumber(pick(row, ["count", "freq", "frequency", "total", "bigram_count"])) ?? 0;
    if (count < minColloc) {
      if (tracked.has(lemma1)) recordPosEvidence(lemmas.get(lemma1), pos1, count);
      if (tracked.has(lemma2)) recordPosEvidence(lemmas.get(lemma2), pos2, count);
      continue;
    }

    if (tracked.has(lemma2)) {
      const entry = lemmas.get(lemma2);
      recordPosEvidence(entry, pos2, count);
      if (pos1 === "ADJ" && pos2 === "NOUN") {
        recordCollocation(entry.collocationBuckets.adjForNoun, lemma1, count);
      }
      if (pos1 === "VERB" && pos2 === "ADV") {
        recordCollocation(entry.collocationBuckets.verbForAdv, lemma1, count);
      }
    }

    if (tracked.has(lemma1)) {
      const entry = lemmas.get(lemma1);
      recordPosEvidence(entry, pos1, count);
      if (pos1 === "VERB" && pos2 === "NOUN") {
        recordCollocation(entry.collocationBuckets.nounForVerb, lemma2, count);
      }
      if (pos1 === "ADJ" && pos2 === "NOUN") {
        recordCollocation(entry.collocationBuckets.nounForAdj, lemma2, count);
      }
      if (pos1 === "ADV" && pos2 === "ADJ") {
        recordCollocation(entry.collocationBuckets.adjForAdv, lemma2, count);
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

function collectTokensFromSentence(sentence) {
  const matches = sentence.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g);
  return matches ? new Set(matches) : new Set();
}

async function collectExamples({ filePath, lemmas, maxExamples }) {
  try {
    await fs.access(filePath);
  } catch (error) {
    return;
  }

  const tracked = new Set(lemmas.keys());
  if (tracked.size === 0) return;

  const stream = createReadStream(filePath);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const rawLine of rl) {
    const sentence = normalizeSentence(rawLine);
    if (!isSentenceEligible(sentence)) continue;
    const tokens = collectTokensFromSentence(sentence);
    if (tokens.size === 0) continue;
    for (const token of tokens) {
      if (!tracked.has(token)) continue;
      const entry = lemmas.get(token);
      if (entry.examples.size >= maxExamples) continue;
      const key = sentence.toLowerCase();
      if (entry.examples.has(key)) continue;
      entry.examples.set(key, sentence);
      if (entry.examples.size >= maxExamples && entry.examples.size === maxExamples) {
        // keep as is; no early exit to allow other lemmas in same sentence.
      }
    }
  }
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
  const result = {};
  const { min, max } = limits;

  if (pos === "NOUN") {
    const candidates = sortBucket(entry.collocationBuckets.adjForNoun, max);
    if (candidates.length >= min) {
      result.ADJ = candidates;
    }
  } else if (pos === "VERB") {
    const candidates = sortBucket(entry.collocationBuckets.nounForVerb, max);
    if (candidates.length >= min) {
      result.NOUN = candidates;
    }
  } else if (pos === "ADJ") {
    const candidates = sortBucket(entry.collocationBuckets.nounForAdj, max);
    if (candidates.length >= min) {
      result.NOUN = candidates;
    }
  } else if (pos === "ADV") {
    const verbCandidates = sortBucket(entry.collocationBuckets.verbForAdv, max);
    if (verbCandidates.length >= min) {
      result.VERB = verbCandidates;
    }
    const adjCandidates = sortBucket(entry.collocationBuckets.adjForAdv, max);
    if (adjCandidates.length >= min) {
      result.ADJ = adjCandidates;
    }
  }

  return result;
}

function sortBucket(bucket, max) {
  return Array.from(bucket.entries())
    .sort((a, b) => {
      if (b[1].count === a[1].count) {
        return a[0].localeCompare(b[0]);
      }
      return b[1].count - a[1].count;
    })
    .map(([key]) => key)
    .filter((value) => value)
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
}) {
  const summary = {
    lemmasSeen,
    cardsEmitted: cards.length,
    withExamples: cardsWithExamples,
    avgExamplesPerCard: cards.length ? Number((totalExamples / cards.length).toFixed(2)) : 0,
    withCollocations: cardsWithCollocations,
    avgCollocsPerCard: cards.length ? Number((totalCollocations / cards.length).toFixed(2)) : 0,
    posBreakdown: posCounts,
    missingFreq: missingFreq,
  };
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
      },
      null,
      2,
    ),
  );

  const { totalTokens, lemmas } = await collectFreqStats({ filePath: freqPath, limit });
  const lemmasSeen = lemmas.size;

  await collectTokenPos({ filePath: tokensPath, lemmas });
  await collectBigrams({ filePath: bigramPath, lemmas, minColloc });
  await collectExamples({ filePath: sentencesPath, lemmas, maxExamples });

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
    const collocCount = Object.values(collocations).reduce((sum, arr) => sum + arr.length, 0);

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
      collocations,
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

  logSummary({
    lemmasSeen,
    cards,
    totalExamples,
    cardsWithExamples,
    totalCollocations,
    cardsWithCollocations,
    posCounts,
    missingFreq,
  });

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
