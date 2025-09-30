#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const options = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "";
    options.set(token, value);
  }
  return options;
}

function ensureFilePath(value, flag) {
  if (!value) {
    throw new Error(`Missing required ${flag} argument`);
  }
  return path.resolve(process.cwd(), value);
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

function parsePipeList(value) {
  if (!value) return [];
  return value
    .split("|")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function csvEscape(value) {
  const str = value == null ? "" : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const inputPath = ensureFilePath(opts.get("--in"), "--in");
  const outputPath = ensureFilePath(opts.get("--out"), "--out");

  const raw = await fs.readFile(inputPath, "utf8");
  const lines = raw.replace(/^\ufeff/, "").split(/\r?\n/);
  if (lines.length === 0) {
    throw new Error("Input file is empty");
  }

  const parser = buildCsvParser();
  const header = parser.parseLine(lines[0]).map((column) => column.trim().toLowerCase());
  const columnIndex = new Map(header.map((name, index) => [name, index]));

  const required = ["left", "right"];
  const missing = required.filter((name) => !columnIndex.has(name));
  if (missing.length > 0) {
    throw new Error(`Input file missing required column(s): ${missing.join(", ")}`);
  }

  const rows = [];
  let legacyRows = 0;
  let pairRows = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || line.trim().length === 0) {
      continue;
    }
    const values = parser.parseLine(line).map((value) => value.replace(/^\ufeff/, ""));
    const leftRaw = (values[columnIndex.get("left") ?? -1] ?? "").trim();
    const rightRaw = (values[columnIndex.get("right") ?? -1] ?? "").trim();
    if (!leftRaw || !rightRaw) {
      continue;
    }

    const level = columnIndex.has("level") ? values[columnIndex.get("level")] ?? "" : "";
    const type = columnIndex.has("type") ? values[columnIndex.get("type")] ?? "matching" : "matching";
    const source = columnIndex.has("source") ? values[columnIndex.get("source")] ?? "" : "";
    const license = columnIndex.has("license") ? values[columnIndex.get("license")] ?? "" : "";
    const countRaw = columnIndex.has("count") ? values[columnIndex.get("count")] ?? "" : "";

    const leftParts = parsePipeList(leftRaw);
    const rightParts = parsePipeList(rightRaw);

    if (leftParts.length > 1 || rightParts.length > 1) {
      legacyRows += 1;
    }

    const pairCount = Math.min(leftParts.length || 1, rightParts.length || 1);
    const fallbackLeft = leftParts.length === 0 ? [leftRaw] : leftParts;
    const fallbackRight = rightParts.length === 0 ? [rightRaw] : rightParts;

    for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
      rows.push([
        level,
        type || "matching",
        fallbackLeft[pairIndex] ?? fallbackLeft[0] ?? leftRaw,
        fallbackRight[pairIndex] ?? fallbackRight[0] ?? rightRaw,
        source,
        license,
        countRaw,
      ]);
      pairRows += 1;
    }
  }

  const outputHeader = ["level", "type", "left", "right", "source", "license", "count"];
  const bom = "\ufeff";
  const csvLines = [
    outputHeader.map(csvEscape).join(","),
    ...rows.map((row) => row.map(csvEscape).join(",")),
  ];
  await fs.writeFile(outputPath, `${bom}${csvLines.join("\n")}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        task: "convert-matching-set-to-pairs",
        input: path.relative(process.cwd(), inputPath),
        output: path.relative(process.cwd(), outputPath),
        legacyRows,
        pairRows,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
