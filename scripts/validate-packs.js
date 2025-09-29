#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Papa from "papaparse";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REQUIRED_HEADERS = {
  gapfill: ["level", "type", "prompt", "answer"],
  matching: ["level", "type", "left", "right"],
  mcq: ["type", "prompt", "options", "answer"],
  scramble: ["level", "type", "prompt", "answer"],
};

const PROMPT_MIN_LENGTH = 5;
const PROMPT_MAX_LENGTH = 280;

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

function inferPackType(filePath) {
  const base = path.basename(filePath).toLowerCase();
  if (base.startsWith("gapfill")) return "gapfill";
  if (base.startsWith("matching")) return "matching";
  if (base.startsWith("mcq")) return "mcq";
  if (base.startsWith("scramble")) return "scramble";
  return null;
}

function safeString(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value == null) {
    return "";
  }
  return String(value).trim();
}

function normalizeText(value) {
  return safeString(value).toLowerCase().replace(/\s+/g, " ");
}

function splitList(value) {
  return safeString(value)
    .split("|")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function analyzeGapfill(rows, warnings) {
  const seen = new Set();
  rows.forEach((row, index) => {
    const prompt = safeString(row.prompt);
    const answer = safeString(row.answer);
    if (!prompt || !answer) {
      warnings.push(`Row ${index + 1}: missing prompt or answer.`);
      return;
    }
    if (prompt.length < PROMPT_MIN_LENGTH || prompt.length > PROMPT_MAX_LENGTH) {
      warnings.push(`Row ${index + 1}: prompt length ${prompt.length} outside ${PROMPT_MIN_LENGTH}-${PROMPT_MAX_LENGTH}.`);
    }
    const key = `${normalizeText(prompt)}|${normalizeText(answer)}`;
    if (seen.has(key)) {
      warnings.push(`Row ${index + 1}: duplicate prompt/answer combination.`);
    }
    seen.add(key);
  });
}

function analyzeScramble(rows, warnings) {
  const seen = new Set();
  rows.forEach((row, index) => {
    const prompt = safeString(row.prompt);
    const answer = safeString(row.answer);
    if (!prompt || !answer) {
      warnings.push(`Row ${index + 1}: missing prompt or answer.`);
      return;
    }
    if (answer.length < PROMPT_MIN_LENGTH || answer.length > PROMPT_MAX_LENGTH) {
      warnings.push(`Row ${index + 1}: answer length ${answer.length} outside ${PROMPT_MIN_LENGTH}-${PROMPT_MAX_LENGTH}.`);
    }
    const key = `${normalizeText(prompt)}|${normalizeText(answer)}`;
    if (seen.has(key)) {
      warnings.push(`Row ${index + 1}: duplicate prompt/answer combination.`);
    }
    seen.add(key);
  });
}

function analyzeMcq(rows, warnings) {
  const seen = new Set();
  rows.forEach((row, index) => {
    const prompt = safeString(row.prompt);
    const answer = safeString(row.answer);
    const options = splitList(row.options);
    if (!prompt || !answer || options.length === 0) {
      warnings.push(`Row ${index + 1}: missing prompt, answer, or options.`);
      return;
    }
    if (!options.includes(answer)) {
      warnings.push(`Row ${index + 1}: answer not present in options.`);
    }
    const key = `${normalizeText(prompt)}|${normalizeText(answer)}`;
    if (seen.has(key)) {
      warnings.push(`Row ${index + 1}: duplicate prompt/answer combination.`);
    }
    seen.add(key);
  });
}

function analyzeMatching(rows, warnings) {
  const seen = new Set();
  rows.forEach((row, index) => {
    const leftValues = splitList(row.left);
    const rightValues = splitList(row.right);
    if (leftValues.length === 0 || rightValues.length === 0) {
      warnings.push(`Row ${index + 1}: missing left/right values.`);
      return;
    }
    if (leftValues.length !== rightValues.length) {
      warnings.push(`Row ${index + 1}: left/right counts differ (${leftValues.length} vs ${rightValues.length}); shorter side used.`);
    }
    const pairKey = leftValues
      .slice(0, Math.min(leftValues.length, rightValues.length))
      .map((left, pairIndex) => `${normalizeText(left)}→${normalizeText(rightValues[pairIndex] ?? "")}`)
      .join("|");
    if (seen.has(pairKey)) {
      warnings.push(`Row ${index + 1}: duplicate pair set detected.`);
    }
    seen.add(pairKey);
  });
}

async function analyzeCsv(filePath) {
  let content;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch (error) {
    return {
      rows: 0,
      warnings: [],
      errors: [`Unable to read file (${error instanceof Error ? error.message : String(error)})`],
      fatal: true,
    };
  }

  const type = inferPackType(filePath);
  if (!type) {
    return {
      rows: 0,
      warnings: [`Skipped: could not infer pack type for ${path.basename(filePath)}`],
      errors: [],
      fatal: false,
    };
  }

  const warnings = [];
  const errors = [];

  const result = Papa.parse(content, {
    header: true,
    skipEmptyLines: "greedy",
  });

  if (result.errors && result.errors.length > 0) {
    const truncated = result.errors.slice(0, 5).map((issue) => `${issue.message} (row ${issue.row ?? "?"})`);
    warnings.push(`Parser reported ${result.errors.length} issue(s): ${truncated.join("; ")}`);
  }

  const headers = Array.isArray(result.meta?.fields) ? result.meta.fields.map((field) => field.trim()) : [];
  if (headers.length === 0) {
    errors.push("Missing header row.");
    return { rows: 0, warnings, errors, fatal: true };
  }

  const required = REQUIRED_HEADERS[type] ?? [];
  const headerSet = new Set(headers.map((header) => header.toLowerCase()));
  const missing = required.filter((column) => !headerSet.has(column));
  if (missing.length > 0) {
    errors.push(`Missing required column(s): ${missing.join(", ")}.`);
  }

  const rows = Array.isArray(result.data) ? (result.data.filter((row) => Object.keys(row).length > 0)) : [];
  const rowCount = rows.length;

  switch (type) {
    case "gapfill":
      analyzeGapfill(rows, warnings);
      break;
    case "matching":
      analyzeMatching(rows, warnings);
      break;
    case "mcq":
      analyzeMcq(rows, warnings);
      break;
    case "scramble":
      analyzeScramble(rows, warnings);
      break;
    default:
      break;
  }

  return {
    rows: rowCount,
    warnings,
    errors,
    fatal: missing.length > 0,
  };
}

async function validateFile(filePath) {
  const analysis = await analyzeCsv(filePath);
  return { filePath, ...analysis };
}

async function collectLevelResults(root, entry, levelFilter) {
  if (!entry.isDirectory()) {
    return [];
  }
  if (levelFilter && entry.name.toLowerCase() !== levelFilter.toLowerCase()) {
    return [];
  }
  const levelDir = path.join(root, entry.name);
  const files = await fs.readdir(levelDir, { withFileTypes: true });
  const csvFiles = files.filter((file) => file.isFile() && file.name.endsWith(".csv"));
  const results = [];
  for (const file of csvFiles) {
    const filePath = path.join(levelDir, file.name);
    results.push(await validateFile(filePath));
  }
  return results;
}

async function validateDirectory(root, levelFilter) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    console.error(`Unable to read packs directory: ${root}`);
    console.error(error);
    return { results: [], fatal: true };
  }

  const results = [];
  for (const entry of entries) {
    const levelResults = await collectLevelResults(root, entry, levelFilter);
    results.push(...levelResults);
  }
  return { results, fatal: false };
}

function printResults(results) {
  results.forEach((result) => {
    const relative = path.relative(process.cwd(), result.filePath);
    console.log(`\n${relative}`);
    console.log(`  Rows: ${result.rows}`);
    if (result.errors.length > 0) {
      result.errors.forEach((message) => console.log(`  ERROR: ${message}`));
    }
    if (result.warnings.length > 0) {
      result.warnings.forEach((message) => console.log(`  Warning: ${message}`));
    }
  });

  const summary = results.map((result) => ({
    file: path.relative(process.cwd(), result.filePath),
    rows: result.rows,
    warnings: result.warnings.length,
    errors: result.errors.length,
  }));

  if (summary.length > 0) {
    console.log("\nSummary:");
    console.table(summary);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const defaultRoot = path.resolve(__dirname, "../public/packs");
  const singlePack = options.get("--pack");
  const levelFilter = options.get("--level") ?? "";
  const rootDir = options.get("--dir") ? path.resolve(options.get("--dir")) : defaultRoot;

  if (singlePack) {
    const result = await validateFile(path.resolve(singlePack));
    printResults([result]);
    if (result.fatal) {
      process.exitCode = 1;
    }
    return;
  }

  console.log(`[validate] Scanning packs in ${rootDir}`);
  const { results, fatal } = await validateDirectory(rootDir, levelFilter);

  if (fatal) {
    process.exitCode = 1;
    return;
  }

  if (results.length === 0) {
    console.log("No CSV files found.");
    return;
  }

  printResults(results);
  const hasFatal = results.some((result) => result.fatal);
  if (hasFatal) {
    process.exitCode = 1;
  }
  if (results.some((result) => result.errors.length > 0 || result.warnings.length > 0)) {
    console.log("\nReview warnings above before publishing packs.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
