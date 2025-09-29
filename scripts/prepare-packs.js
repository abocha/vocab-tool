#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FILE_NAMES = ["gapfill.csv", "matching.csv", "mcq.csv", "scramble.csv"];

function parseArgs() {
  const args = process.argv.slice(2);
  const result = new Map();
  for (let i = 0; i < args.length; i += 1) {
    const current = args[i];
    if (current.startsWith("--")) {
      const key = current;
      const value = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
      result.set(key, value);
    }
  }
  return result;
}

function parseLimit(raw) {
  if (typeof raw !== "string") {
    return undefined;
  }
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value < 1) {
    return undefined;
  }
  return value;
}

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function copyFile(source, destination) {
  await ensureDirectory(path.dirname(destination));
  await fs.copyFile(source, destination);
}

async function copyWithSample(source, destination, limit) {
  await ensureDirectory(path.dirname(destination));
  const content = await fs.readFile(source, "utf8");
  const lines = content.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) {
    return;
  }
  const [header, ...rows] = lines;
  const sampledRows = rows.slice(0, limit);
  const finalRows = [header, ...sampledRows].join("\n");
  await fs.writeFile(destination, `${finalRows}\n`, "utf8");
}

async function main() {
  const args = parseArgs();
  const sourceRoot = args.get("--source")
    ? path.resolve(args.get("--source"))
    : path.join(os.homedir(), "corpus", "simplewiki", "packs");
  const destRoot = args.get("--dest")
    ? path.resolve(args.get("--dest"))
    : path.resolve(__dirname, "../public/packs");
  const sampleLimit = parseLimit(args.get("--sample"));

  console.log(`Copying packs from ${sourceRoot} → ${destRoot}`);
  if (sampleLimit) {
    console.log(`Sampling first ${sampleLimit} rows per file.`);
  }

  let levels;
  try {
    const entries = await fs.readdir(sourceRoot, { withFileTypes: true });
    levels = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    console.error("Failed to read source directory", error);
    process.exitCode = 1;
    return;
  }

  if (levels.length === 0) {
    console.warn("No level folders found. Nothing to copy.");
    return;
  }

  for (const level of levels) {
    const sourceLevelPath = path.join(sourceRoot, level);
    const destLevelPath = path.join(destRoot, level);
    await ensureDirectory(destLevelPath);

    for (const fileName of FILE_NAMES) {
      const sourceFile = path.join(sourceLevelPath, fileName);
      const destFile = path.join(destLevelPath, fileName);
      try {
        await fs.access(sourceFile);
      } catch (error) {
        console.warn(`Skipping missing file: ${sourceFile}`);
        continue;
      }

      if (sampleLimit) {
        await copyWithSample(sourceFile, destFile, sampleLimit);
      } else {
        await copyFile(sourceFile, destFile);
      }
      console.log(`Copied ${level}/${fileName}`);
    }
  }

  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
