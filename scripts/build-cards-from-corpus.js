#!/usr/bin/env node
// Draft stub for Corpus → Cards adapter. Keeps deterministic structure ready for implementation.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveInput(root, relative) {
  return path.resolve(root, relative);
}

async function readCsvPlaceholder(filePath) {
  // TODO: stream CSV in chunks; placeholder keeps hook deterministic.
  try {
    await fs.access(filePath);
  } catch (error) {
    console.warn(`Missing input file: ${filePath}`);
    return [];
  }
  // Returning empty array so downstream code can stay deterministic until implemented.
  return [];
}

async function createDraftCards({ freqFile, bigramsFile, sentencesFile }) {
  const freqRows = await readCsvPlaceholder(freqFile);
  const bigramRows = await readCsvPlaceholder(bigramsFile);
  const sentences = await readCsvPlaceholder(sentencesFile);

  // TODO: implement deterministic merging + heuristics described in docs/07.
  void freqRows;
  void bigramRows;
  void sentences;

  return [];
}

async function writeCards(outputFile, cards) {
  const directory = path.dirname(outputFile);
  await fs.mkdir(directory, { recursive: true });
  const lines = cards.map((card) => JSON.stringify(card));
  await fs.writeFile(outputFile, `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  const args = process.argv.slice(2);
  const options = new Map();
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i];
    if (!key.startsWith("--")) continue;
    const value = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "";
    options.set(key, value);
  }

  const corpusRoot = options.get("--corpus")
    ? path.resolve(options.get("--corpus"))
    : resolveInput(__dirname, "../corpus/simplewiki");
  const level = options.get("--level") ?? "A2";
  const outputFile = options.get("--out")
    ? path.resolve(options.get("--out"))
    : resolveInput(__dirname, `../cards/draft_cards_${level.toLowerCase()}.jsonl`);

  const freqFile = resolveInput(corpusRoot, "data/freq_lemmas.csv");
  const bigramsFile = resolveInput(corpusRoot, "data/bigrams.csv");
  const sentencesFile = resolveInput(corpusRoot, `clean/sentences_${level}.txt`);

  console.log(`[cards] Building draft cards for level ${level}`);
  console.log(`freq: ${freqFile}`);
  console.log(`bigrams: ${bigramsFile}`);
  console.log(`sentences: ${sentencesFile}`);

  const cards = await createDraftCards({ freqFile, bigramsFile, sentencesFile });

  if (cards.length === 0) {
    console.log("No cards generated yet (stub). TODO: implement scoring heuristics.");
  }

  await writeCards(outputFile, cards);
  console.log(`Draft cards written to ${outputFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
