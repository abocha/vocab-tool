#!/usr/bin/env node
// Stub CLI for pack validation. Surfaces basic counts now; heuristics from docs/09-validators.md remain TODO.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

async function summarizeCsv(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.split(/\r?\n/).filter((line) => line.length > 0);
    if (lines.length === 0) {
      return { rows: 0 };
    }
    return { rows: Math.max(0, lines.length - 1) };
  } catch (error) {
    console.warn(`Unable to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    return { rows: 0 };
  }
}

async function validateFile(filePath) {
  const summary = await summarizeCsv(filePath);
  const relative = path.relative(process.cwd(), filePath);
  console.log(`- ${relative} → ${summary.rows} row(s). TODO: run heuristics & duplicates check (docs/09-validators.md).`);
}

async function validateDirectory(root, levelFilter) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    console.error(`Unable to read packs directory: ${root}`);
    console.error(error);
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (levelFilter && entry.name.toLowerCase() !== levelFilter.toLowerCase()) continue;

    const levelDir = path.join(root, entry.name);
    const files = await fs.readdir(levelDir, { withFileTypes: true });
    const csvFiles = files.filter((file) => file.isFile() && file.name.endsWith(".csv"));

    if (csvFiles.length === 0) {
      console.log(`Level ${entry.name}: no CSV files found.`);
      continue;
    }

    console.log(`Level ${entry.name}:`);
    for (const file of csvFiles) {
      await validateFile(path.join(levelDir, file.name));
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const defaultRoot = path.resolve(__dirname, "../public/packs");
  const singlePack = options.get("--pack");
  const levelFilter = options.get("--level") ?? "";
  const rootDir = options.get("--dir") ? path.resolve(options.get("--dir")) : defaultRoot;

  if (singlePack) {
    await validateFile(path.resolve(singlePack));
    console.log("TODO: add exit codes once catastrophic failures are detected.");
    return;
  }

  console.log(`[validate] Scanning packs in ${rootDir}`);
  await validateDirectory(rootDir, levelFilter);
  console.log("Summary: TODO — aggregate pass/fail counts once validators are implemented.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
