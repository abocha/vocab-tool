#!/usr/bin/env node
// Draft CLI to transform cards into exercise packs. Builders are stubs awaiting heuristics.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadCards(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return content
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  } catch (error) {
    console.warn(`Unable to read cards input: ${filePath}`);
    console.warn("TODO: hook into cards builder once implemented.");
    return [];
  }
}

function buildGapFillPack(cards) {
  // TODO: use card examples to blank a single token per docs/08.
  void cards;
  return [];
}

function buildMatchingPack(cards) {
  // TODO: compose left/right pairs from collocations; emit both shapes if needed.
  void cards;
  return [];
}

function buildMcqPack(cards) {
  // TODO: generate prompts with distractors sharing POS.
  void cards;
  return [];
}

function buildScramblePack(cards) {
  // TODO: derive sentences, shuffle tokens deterministically.
  void cards;
  return [];
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
  const lines = [header, ...rows.map((row) => row.map(csvEscape).join(","))];
  await fs.writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
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

  const level = options.get("--level") ?? "A2";
  const cardsFile = options.get("--cards")
    ? path.resolve(options.get("--cards"))
    : path.resolve(__dirname, `../cards/draft_cards_${level.toLowerCase()}.jsonl`);
  const outputDir = options.get("--out")
    ? path.resolve(options.get("--out"))
    : path.resolve(__dirname, `../public/packs/${level}`);

  console.log(`[packs] Building CSV packs for level ${level}`);
  console.log(`cards: ${cardsFile}`);

  const cards = await loadCards(cardsFile);
  if (cards.length === 0) {
    console.log("No cards to process (stub).");
  }

  const gapfillRows = buildGapFillPack(cards);
  const matchingRows = buildMatchingPack(cards);
  const mcqRows = buildMcqPack(cards);
  const scrambleRows = buildScramblePack(cards);

  await writeCsv(path.join(outputDir, "gapfill.csv"), "level,type,prompt,answer,source,license", gapfillRows);
  await writeCsv(path.join(outputDir, "matching.csv"), "level,type,left,right,source,license,count", matchingRows);
  await writeCsv(path.join(outputDir, "mcq.csv"), "type,prompt,options,answer,source,license", mcqRows);
  await writeCsv(path.join(outputDir, "scramble.csv"), "level,type,prompt,answer,source,license", scrambleRows);

  console.log(`CSV packs written to ${outputDir} (stub outputs empty until builders are implemented).`);
  console.log("Summary: TODO — report per-exercise counts and TODO fallbacks once builders exist.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
