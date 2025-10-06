#!/usr/bin/env node
import { createReadStream, readFileSync } from "node:fs";
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
const confusables = JSON.parse(
  readFileSync(new URL("./confusables.json", import.meta.url), "utf8"),
);

const COLLLOCATION_FAMILY_INDEX = buildCollocationFamilyIndex(confusables.collocationFamilies);
const CURATED_SET_INDEX = buildCuratedSetIndex(confusables.curatedSets);
const KNOWN_LEVELS = Object.freeze(["A1", "A2", "B1", "B2"]);

let presetLibraryManifest = { presets: [], libraryVersion: 0 };
const presetMap = new Map();
try {
  presetLibraryManifest = JSON.parse(
    readFileSync(new URL("../presets/library.json", import.meta.url), "utf8"),
  );
  const presets = Array.isArray(presetLibraryManifest.presets) ? presetLibraryManifest.presets : [];
  presets.forEach((preset) => {
    if (preset && typeof preset.id === "string") {
      presetMap.set(preset.id, preset);
    }
  });
} catch (error) {
  console.warn(
    `Preset library could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
  );
}

function getPresetDefinition(presetId) {
  if (!presetId) return null;
  return presetMap.get(presetId) ?? null;
}

const SOURCE_FALLBACK = "simplewiki";
const LICENSE_FALLBACK = "CC BY-SA";
const GAPFILL_MIN_LENGTH = 40;
const GAPFILL_MAX_LENGTH = 120;
const GAPFILL_BANK_DEFAULT_SIZE = 6;
const GAPFILL_BANK_MIN = 4;
const GAPFILL_BANK_MAX = 8;
const DISTRACTOR_TOLERANCE = 0.3;
const BANK_DEFAULT_BY_LEVEL = {
  A1: 4,
  A2: 6,
  B1: 7,
  B2: 8,
};
const MIN_BANK_BY_LEVEL = {
  A1: 4,
  A2: 5,
  B1: 6,
  B2: 6,
};
const SOFT_OK_DELTA = 1;
const MAX_RELAXED_PER_BANK = 1;
const PACK_DISTRACTOR_COOLDOWN = 20;
const MAX_BLANKS_BY_LEVEL = {
  A1: 1,
  A2: 1,
  B1: 2,
  B2: 2,
};
const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "to",
  "for",
  "with",
  "at",
  "on",
  "in",
  "of",
  "from",
  "by",
  "about",
  "into",
  "over",
  "under",
  "between",
  "and",
  "or",
  "but",
]);
const FUNCTION_WORDS = new Set([
  ...STOPWORDS,
  "has",
  "have",
  "had",
  "is",
  "are",
  "was",
  "were",
  "been",
  "being",
  "be",
  "do",
  "does",
  "did",
  "can",
  "could",
  "should",
  "would",
  "may",
  "might",
  "must",
  "shall",
  "will",
]);
const TIME_WORDS = new Set([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "today",
  "tomorrow",
  "yesterday",
  "week",
  "month",
  "year",
  "morning",
  "evening",
  "night",
  "noon",
  "midnight",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "am",
  "pm",
  "hour",
  "minute",
  "afternoon"
]);
const PLACE_WORDS = new Set([
  "home",
  "school",
  "office",
  "park",
  "room",
  "city",
  "town",
  "village",
  "country",
  "street",
  "road",
  "building",
  "house",
  "restaurant",
  "airport",
  "station",
  "library",
  "shop",
  "store"
]);
const MONTH_WORDS = new Set([
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december"
]);
const packCooldown = new Map();

function buildCollocationFamilyIndex(source) {
  const map = new Map();
  if (Array.isArray(source)) {
    source.forEach((entry, index) => {
      if (!entry || typeof entry !== "object") return;
      const id = typeof entry.id === "string" ? entry.id : `family_${index}`;
      const anchor = typeof entry.anchor === "string" ? entry.anchor.toLowerCase() : null;
      const pos = typeof entry.pos === "string" ? entry.pos.toUpperCase() : null;
      const levels = Array.isArray(entry.levels)
        ? entry.levels.map((level) => String(level).toUpperCase()).filter(Boolean)
        : null;
      const theme = typeof entry.theme === "string" ? entry.theme : null;
      const entries = normalizeFamilyEntries(entry.entries);
      map.set(id, { id, anchor, pos, levels, theme, entries });
    });
  } else if (source && typeof source === "object") {
    Object.entries(source).forEach(([id, value]) => {
      if (!value || typeof value !== "object") return;
      const anchor = id.includes("(") ? id.slice(0, id.indexOf("(")).toLowerCase() : id.toLowerCase();
      const pos = id.includes("(") ? id.slice(id.indexOf("(") + 1, id.indexOf(")")).toUpperCase() : null;
      map.set(id, { id, anchor, pos, levels: null, theme: null, entries: normalizeFamilyEntries(value) });
    });
  }
  return map;
}

function buildCuratedSetIndex(source) {
  const map = new Map();
  if (!source || typeof source !== "object") {
    return map;
  }
  Object.entries(source).forEach(([posKey, list]) => {
    if (!Array.isArray(list)) return;
    const pos = String(posKey).toUpperCase();
    const entries = list
      .map((item, index) => {
        if (!item || typeof item !== "object") return null;
        const words = Array.isArray(item.words) ? item.words.filter(Boolean) : [];
        if (words.length === 0) return null;
        const id = typeof item.id === "string" ? item.id : `${pos.toLowerCase()}_${index}`;
        const levels = Array.isArray(item.levels)
          ? item.levels.map((level) => String(level).toUpperCase()).filter(Boolean)
          : null;
        const theme = typeof item.theme === "string" ? item.theme : null;
        return {
          id,
          levels,
          theme,
          words,
          wordsLower: words.map((word) => word.toLowerCase()),
        };
      })
      .filter(Boolean);
    map.set(pos, entries);
  });
  return map;
}

function normalizeFamilyEntries(raw) {
  const result = {};
  if (!raw || typeof raw !== "object") {
    return result;
  }
  Object.entries(raw).forEach(([posKey, list]) => {
    if (!Array.isArray(list)) return;
    const pos = String(posKey).toUpperCase();
    result[pos] = list.filter(Boolean);
  });
  return result;
}

function normalizeLevel(value) {
  if (!value) return "";
  return String(value).toUpperCase();
}

function levelMatches(levels, level) {
  if (!level) return true;
  if (!Array.isArray(levels) || levels.length === 0) return true;
  const normalized = normalizeLevel(level);
  return levels.includes(normalized);
}

function createBankTelemetry() {
  return {
    totals: {
      banks: 0,
      relaxed: 0,
      untagged: 0,
      tags: new Map(),
      sizeBuckets: new Map(),
    },
    byLevel: new Map(),
    byPreset: new Map(),
  };
}

function ensureTelemetryEntry(map, key, { trackLevels = false } = {}) {
  if (!map.has(key)) {
    map.set(key, {
      banks: 0,
      relaxed: 0,
      tags: new Map(),
      sizeBuckets: new Map(),
      levels: trackLevels ? new Map() : undefined,
    });
  }
  return map.get(key);
}

function recordBankTelemetry(telemetry, { level, presetId, tags, bankSize, usedRelax }) {
  if (!telemetry) return;
  const normalizedLevel = normalizeLevel(level) || "UNKNOWN";
  const sizeKey = String(bankSize ?? 0);
  const tagSet = tags instanceof Set ? tags : new Set(tags ?? []);

  const totals = telemetry.totals;
  totals.banks += 1;
  totals.sizeBuckets.set(sizeKey, (totals.sizeBuckets.get(sizeKey) ?? 0) + 1);
  const effectiveTags = Array.from(tagSet).filter((tag) => tag && tag !== "preset");
  if (effectiveTags.length === 0) {
    totals.untagged += 1;
  } else {
    effectiveTags.forEach((tag) => {
      totals.tags.set(tag, (totals.tags.get(tag) ?? 0) + 1);
    });
  }
  if (usedRelax) {
    totals.relaxed += 1;
  }

  const levelEntry = ensureTelemetryEntry(telemetry.byLevel, normalizedLevel);
  levelEntry.banks += 1;
  levelEntry.sizeBuckets.set(sizeKey, (levelEntry.sizeBuckets.get(sizeKey) ?? 0) + 1);
  effectiveTags.forEach((tag) => {
    levelEntry.tags.set(tag, (levelEntry.tags.get(tag) ?? 0) + 1);
  });
  if (usedRelax) {
    levelEntry.relaxed += 1;
  }

  if (presetId) {
    const presetEntry = ensureTelemetryEntry(telemetry.byPreset, presetId, { trackLevels: true });
    presetEntry.banks += 1;
    presetEntry.sizeBuckets.set(sizeKey, (presetEntry.sizeBuckets.get(sizeKey) ?? 0) + 1);
    effectiveTags.forEach((tag) => {
      presetEntry.tags.set(tag, (presetEntry.tags.get(tag) ?? 0) + 1);
    });
    if (usedRelax) {
      presetEntry.relaxed += 1;
    }
    if (presetEntry.levels) {
      presetEntry.levels.set(
        normalizedLevel,
        (presetEntry.levels.get(normalizedLevel) ?? 0) + 1,
      );
    }
  }
}

function mapToObject(map) {
  const result = {};
  if (!map) return result;
  map.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function serializeTelemetryEntry(entry, { includeLevels = false } = {}) {
  if (!entry) {
    return { banks: 0, relaxed: 0, tags: {}, sizeBuckets: {} };
  }
  const serialized = {
    banks: entry.banks ?? 0,
    relaxed: entry.relaxed ?? 0,
    tags: mapToObject(entry.tags ?? new Map()),
    sizeBuckets: mapToObject(entry.sizeBuckets ?? new Map()),
  };
  if (includeLevels && entry.levels) {
    serialized.levels = mapToObject(entry.levels);
  }
  return serialized;
}

function serializeBankTelemetry(telemetry) {
  if (!telemetry) return null;
  return {
    totals: {
      banks: telemetry.totals.banks,
      relaxed: telemetry.totals.relaxed,
      untagged: telemetry.totals.untagged,
      tags: mapToObject(telemetry.totals.tags),
      sizeBuckets: mapToObject(telemetry.totals.sizeBuckets),
    },
    byLevel: Object.fromEntries(
      Array.from(telemetry.byLevel.entries()).map(([level, entry]) => [
        level,
        serializeTelemetryEntry(entry),
      ]),
    ),
    byPreset: Object.fromEntries(
      Array.from(telemetry.byPreset.entries()).map(([preset, entry]) => [
        preset,
        serializeTelemetryEntry(entry, { includeLevels: true }),
      ]),
    ),
  };
}

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

function clampBankSize(value) {
  if (!Number.isFinite(value)) {
    return GAPFILL_BANK_DEFAULT_SIZE;
  }
  const rounded = Math.round(value);
  if (rounded < GAPFILL_BANK_MIN) return GAPFILL_BANK_MIN;
  if (rounded > GAPFILL_BANK_MAX) return GAPFILL_BANK_MAX;
  return rounded;
}

function normalizeTokenLower(value) {
  return normalizeToken(value).toLowerCase();
}

function tokenMatchesCollocationVariant(tokenLower, collocationLower) {
  if (!tokenLower || !collocationLower) return false;
  if (tokenLower === collocationLower) return true;
  if (tokenLower.endsWith("s") && tokenLower.slice(0, -1) === collocationLower) return true;
  if (collocationLower.endsWith("s") && collocationLower.slice(0, -1) === tokenLower) return true;
  if (tokenLower.endsWith("es") && tokenLower.slice(0, -2) === collocationLower) return true;
  if (collocationLower.endsWith("es") && collocationLower.slice(0, -2) === tokenLower) return true;
  if (tokenLower.endsWith("ed") && tokenLower.slice(0, -2) === collocationLower) return true;
  if (collocationLower.endsWith("ed") && collocationLower.slice(0, -2) === tokenLower) return true;
  if (tokenLower.endsWith("ing") && tokenLower.slice(0, -3) === collocationLower) return true;
  if (collocationLower.endsWith("ing") && collocationLower.slice(0, -3) === tokenLower) return true;
  return false;
}

function slotSignature(slot) {
  const parts = [slot.pos];
  if (slot.morph) parts.push(slot.morph);
  if (slot.anchor) parts.push(slot.anchor);
  else if (slot.domain) parts.push(slot.domain);
  return parts.filter(Boolean).join("|");
}

function deriveNeighborCue(context) {
  if (!Array.isArray(context.tokens)) {
    return null;
  }
  const offsets = [1, -1, 2, -2, 3, -3];
  for (const offset of offsets) {
    const index = context.targetIndex + offset;
    if (index < 0 || index >= context.tokens.length) continue;
    const surface = context.tokens[index]?.surface;
    if (!surface) continue;
    const lower = surface.toLowerCase();
    if (!/[a-z]/.test(lower)) continue;
    if (FUNCTION_WORDS.has(lower)) continue;
    if (lower === context.answerLemma) continue;
    return surface;
  }
  return null;
}

function inferSlot(context) {
  const { answerSurface, answerLemma, tokens, targetIndex, expectedPos, gapMode } = context;
  const slot = {
    pos: expectedPos || guessPos(answerSurface),
    morph: "base",
    anchor: null,
    domain: null,
  };

  const lower = answerSurface.toLowerCase();
  if (lower.endsWith("ing")) slot.morph = "ing";
  else if (lower.endsWith("ed")) slot.morph = "ed";
  else if (lower.endsWith("s") && !lower.endsWith("ss")) slot.morph = "s";

  if (FUNCTION_WORDS.has(lower) || gapMode === "grammar") {
    slot.pos = "FUNCTION";
    slot.morph = classifyFunctionWord(answerSurface);
  }

  const anchorHeads = new Set(confusables.anchorHeads ?? []);
  const window = 4;
  let anchor = null;
  for (let offset = 1; offset <= window; offset += 1) {
    const forward = tokens[targetIndex + offset];
    if (forward && anchorHeads.has(forward.surface?.toLowerCase() ?? "")) {
      anchor = forward.surface.toLowerCase();
      break;
    }
    const backward = tokens[targetIndex - offset];
    if (backward && anchorHeads.has(backward.surface?.toLowerCase() ?? "")) {
      anchor = backward.surface.toLowerCase();
      break;
    }
  }
  if (anchor) {
    slot.anchor = anchor;
  }

  if (slot.pos === "FUNCTION" || gapMode === "grammar") {
    const neighborWords = [];
    for (let i = Math.max(0, targetIndex - 3); i < Math.min(tokens.length, targetIndex + 4); i += 1) {
      if (i === targetIndex) continue;
      const tokenLower = tokens[i]?.surface?.toLowerCase();
      if (tokenLower) neighborWords.push(tokenLower);
    }
    if (neighborWords.some((word) => TIME_WORDS.has(word) || MONTH_WORDS.has(word) || /\d/.test(word))) {
      slot.domain = "TIME";
    } else if (neighborWords.some((word) => PLACE_WORDS.has(word))) {
      slot.domain = "PLACE";
    }
  }

  return slot;
}

function buildLemmaFreqMap(cards) {
  const map = new Map();
  for (const card of cards) {
    if (!card || typeof card.lemma !== "string") continue;
    const key = card.lemma.toLowerCase();
    if (!map.has(key)) {
      map.set(key, typeof card.freq_zipf === "number" ? card.freq_zipf : null);
    }
  }
  return map;
}

function buildCollocationIndex(cards) {
  const index = new Map(); // partner -> Map(pos -> Set(lemma))
  for (const card of cards) {
    if (!card || typeof card.lemma !== "string") continue;
    const pos = typeof card.pos === "string" ? card.pos.toUpperCase() : "";
    const entries = getCollocationEntries(card);
    for (const entry of entries) {
      const partner = entry.partner.toLowerCase();
      if (!index.has(partner)) {
        index.set(partner, new Map());
      }
      const slotMap = index.get(partner);
      const slotKey = entry.slot ?? pos;
      const addLemma = (key) => {
        if (!key) return;
        if (!slotMap.has(key)) {
          slotMap.set(key, new Set());
        }
        slotMap.get(key).add(card.lemma.toLowerCase());
      };
      addLemma(slotKey);
      addLemma(pos);
      addLemma("");
    }
  }
  return index;
}

function getFamilyConfusables(context, slot) {
  if (!slot.anchor) {
    return [];
  }
  const directKey = `${slot.anchor}(N)`;
  let family = COLLLOCATION_FAMILY_INDEX.get(directKey);
  if (!family) {
    for (const entry of COLLLOCATION_FAMILY_INDEX.values()) {
      if (entry.anchor === slot.anchor) {
        family = entry;
        break;
      }
    }
  }
  if (!family) {
    return [];
  }
  if (!levelMatches(family.levels, context.level)) {
    return [];
  }
  const entries = family.entries ?? {};
  const slotKey = slot.pos && entries[slot.pos] ? slot.pos : null;
  const bucket = slotKey
    ? entries[slotKey]
    : entries["VERB"] || entries["ADJ"] || entries["NOUN"] || [];
  return (Array.isArray(bucket) ? bucket : [])
    .filter((lemma) => lemma && lemma.toLowerCase() !== context.answerLemma)
    .map((lemma) => {
      const tags = new Set(["family", "colloc"]);
      if (family.theme) {
        tags.add(`theme:${family.theme}`);
      }
      return {
        surface: matchCasing(context.answerSurface, lemma),
        lemma,
        pos: slot.pos,
        source: "family",
        tags,
        group: family.id,
      };
    });
}

function getPresetFamilyConfusables(context, slot) {
  const extras = Array.isArray(context.extraFamilies) ? context.extraFamilies : [];
  if (extras.length === 0) {
    return [];
  }
  const results = [];
  extras.forEach((key) => {
    if (!key || typeof key !== "string") return;
    const family = COLLLOCATION_FAMILY_INDEX.get(key);
    if (!family) return;
    if (!levelMatches(family.levels, context.level)) return;
    const entries = family.entries ?? {};
    const bucket = entries[slot.pos] ?? entries["VERB"] ?? [];
    (Array.isArray(bucket) ? bucket : []).forEach((lemma) => {
      if (!lemma) return;
      const lower = lemma.toLowerCase();
      if (lower === context.answerLemma) return;
      const tags = new Set(["family", "colloc", "preset"]);
      if (family.theme) {
        tags.add(`theme:${family.theme}`);
      }
      results.push({
        surface: matchCasing(context.answerSurface, lemma),
        lemma,
        pos: slot.pos,
        source: "family",
        tags,
        group: family.id,
      });
    });
  });
  return results;
}

function getDistributionNeighbors(context, collocationIndex) {
  const candidates = [];
  context.cardCollocations.forEach((entry) => {
    const partnerLower = entry.partner.toLowerCase();
    const slotMap = collocationIndex.get(partnerLower);
    if (!slotMap) return;
    const lemmas = slotMap.get(context.expectedPos) ?? slotMap.get("");
    if (!lemmas) return;
    lemmas.forEach((lemma) => {
      if (!lemma || lemma === context.answerLemma) return;
      const surface = matchCasing(context.answerSurface, lemma);
      candidates.push({
        surface,
        lemma,
        pos: context.expectedPos,
        source: "neighbor",
        tags: new Set(["neighbor"]),
        group: partnerLower,
      });
    });
  });
  return candidates;
}

function relaxOnceIfNeeded(candidates, context, shortage, seed) {
  if (shortage <= 0) {
    return { candidates, usedRelaxor: false };
  }

  const limit = Math.max(0, Math.min(shortage, MAX_RELAXED_PER_BANK));
  if (limit === 0) {
    return { candidates, usedRelaxor: false };
  }

  const relaxedCandidates = [...candidates];
  const seen = new Set(relaxedCandidates.map((candidate) => candidate.surface.toLowerCase()));
  let added = 0;
  let usedRelaxor = false;

  const pushCandidate = (candidate) => {
    if (!candidate?.surface) return false;
    if (added >= limit) return false;
    const key = candidate.surface.toLowerCase();
    if (seen.has(key)) return false;
    relaxedCandidates.push(candidate);
    seen.add(key);
    added += 1;
    usedRelaxor = true;
    return true;
  };

  if (context.gapMode === "grammar") {
    const expectedClass = classifyFunctionWord(context.answerSurface);
    const forms = buildParadigmForms(context.answerLemma)
      .map((form) => ({
        surface: matchCasing(context.answerSurface, form),
        lemma: context.answerLemma,
        pos: "FUNCTION",
        source: "relaxed",
        tags: new Set(["relaxed"]),
        group: "relaxed",
      }))
      .filter((candidate) => {
        const lower = candidate.surface.toLowerCase();
        if (lower === context.answerSurface.toLowerCase()) {
          return false;
        }
        return classifyFunctionWord(candidate.surface) === expectedClass;
      });
    for (const candidate of forms) {
      if (pushCandidate(candidate)) {
        if (added >= limit) break;
      }
    }
  }

  if (added < limit) {
    const genericList = (confusables.genericByPOS ?? {})[context.expectedPos] ?? [];
    if (genericList.length > 0) {
      const ordered = deterministicShuffle(genericList, `${seed}|generic`);
      for (const pick of ordered) {
        if (!pick) continue;
        const lowerPick = pick.toLowerCase();
        if (lowerPick === context.answerLemma) continue;
        const candidate = {
          surface: matchCasing(context.answerSurface, pick),
          lemma: lowerPick,
          pos: context.expectedPos,
          source: "relaxed",
          tags: new Set(["relaxed", "curated"]),
          group: "relaxed",
        };
        if (pushCandidate(candidate)) {
          if (added >= limit) break;
        }
      }
    }
  }

  return { candidates: relaxedCandidates, usedRelaxor };
}

function sameSetNearDuplicatePenalty(candidate, other) {
  if (!candidate.group || !other.group) {
    return 0;
  }
  return candidate.group === other.group ? 1 : 0;
}

function shouldThrottleCandidate(lemma) {
  const key = lemma.toLowerCase();
  const count = packCooldown.get(key) ?? 0;
  return count >= PACK_DISTRACTOR_COOLDOWN;
}

function updateCooldown(selected) {
  selected.forEach((candidate) => {
    const key = candidate.lemma.toLowerCase();
    const current = packCooldown.get(key) ?? 0;
    packCooldown.set(key, current + 1);
  });
}

function qualityLabel({ bank, tags, usedRelaxor, minSize }) {
  if (bank.length < minSize - 1) {
    return "needs_review";
  }
  if (bank.length === minSize - 1 || usedRelaxor) {
    return "soft";
  }
  if (!tags.has("family") && !tags.has("colloc") && !tags.has("neighbor")) {
    return "soft";
  }
  return "solid";
}

function buildParadigmForms(lemma) {
  const lower = lemma.toLowerCase();
  const forms = new Set([lower]);
  if (lower.endsWith("e")) {
    forms.add(`${lower}d`);
    forms.add(`${lower.slice(0, -1)}ing`);
  } else {
    forms.add(`${lower}ed`);
    forms.add(`${lower}ing`);
  }
  if (lower.endsWith("y")) {
    forms.add(`${lower.slice(0, -1)}ies`);
  } else if (lower.endsWith("s")) {
    forms.add(`${lower}es`);
  } else {
    forms.add(`${lower}s`);
  }
  return Array.from(forms);
}

function matchCasing(template, word) {
  if (!template) return word;
  if (template === template.toUpperCase()) return word.toUpperCase();
  if (template[0] === template[0].toUpperCase()) {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }
  return word;
}

function inflectLike(answer, lemma) {
  const answerLower = answer.toLowerCase();
  const lemmaLower = lemma.toLowerCase();
  if (answerLower === lemmaLower) {
    return matchCasing(answer, lemmaLower);
  }
  if (answerLower.endsWith("ing")) {
    if (lemmaLower.endsWith("e")) {
      return matchCasing(answer, `${lemmaLower.slice(0, -1)}ing`);
    }
    return matchCasing(answer, `${lemmaLower}ing`);
  }
  if (answerLower.endsWith("ed")) {
    if (lemmaLower.endsWith("e")) {
      return matchCasing(answer, `${lemmaLower}d`);
    }
    return matchCasing(answer, `${lemmaLower}ed`);
  }
  if (answerLower.endsWith("s")) {
    if (lemmaLower.endsWith("y")) {
      return matchCasing(answer, `${lemmaLower.slice(0, -1)}ies`);
    }
    if (lemmaLower.endsWith("s") || lemmaLower.endsWith("x") || lemmaLower.endsWith("ch") || lemmaLower.endsWith("sh")) {
      return matchCasing(answer, `${lemmaLower}es`);
    }
    return matchCasing(answer, `${lemmaLower}s`);
  }
  return matchCasing(answer, lemmaLower);
}

function guessPos(word) {
  const lower = word.toLowerCase();
  if (lower.endsWith("ly")) return "ADV";
  if (lower.endsWith("ing") || lower.endsWith("ed")) return "VERB";
  if (FUNCTION_WORDS.has(lower)) return "FUNCTION";
  if (lower.endsWith("ous") || lower.endsWith("ful") || lower.endsWith("ive") || lower.endsWith("al")) return "ADJ";
  return "NOUN";
}

function classifyFunctionWord(word) {
  const lower = word.toLowerCase();
  if (confusables.articles.includes(lower)) return "article";
  for (const set of confusables.prepositionSets) {
    if (set.includes(lower)) return "preposition";
  }
  if (confusables.auxiliaries.includes(lower)) return "auxiliary";
  return "function";
}

function detectGrammarSlot(tokens, targetIndex) {
  const prev = tokens[targetIndex - 1]?.surface?.toLowerCase() ?? "";
  const next = tokens[targetIndex + 1]?.surface?.toLowerCase() ?? "";
  if (prev === "to") return "infinitive";
  if (["has", "have", "had", "is", "are", "was", "were"].includes(prev)) return "participle";
  if (next && FUNCTION_WORDS.has(next)) return "preposition";
  return "function";
}

function determineGapMode({ answer, card, sentenceLower }) {
  const answerLower = answer.toLowerCase();
  if (FUNCTION_WORDS.has(answerLower)) {
    return "grammar";
  }
  const entries = getCollocationEntries(card);
  for (const entry of entries) {
    if (entry.partner && sentenceLower.includes(entry.partner.toLowerCase())) {
      return "collocation";
    }
  }
  return "target";
}

function generateCollocationConfusables(context, collocationIndex) {
  const results = [];
  const partners = new Set();
  for (const entry of context.cardCollocations) {
    const partnerLower = entry.partner.toLowerCase();
    if (context.sentenceLower.includes(partnerLower)) {
      partners.add(partnerLower);
    }
  }
  partners.forEach((partner) => {
    const slotMap = collocationIndex.get(partner);
    if (!slotMap) return;
    const slotKey = context.expectedPos;
    const lemmas = slotMap.get(slotKey) ?? slotMap.get("");
    if (!lemmas) return;
    lemmas.forEach((lemma) => {
      if (lemma === context.answerLemma) return;
      const surface = inflectLike(context.answerSurface, lemma);
      results.push({
        surface,
        lemma,
        pos: context.expectedPos,
        source: "collocation",
        partner,
        tags: new Set(["colloc"]),
        group: partner,
      });
    });
  });
  return results;
}

function generateParadigmForms(context) {
  const forms = buildParadigmForms(context.answerLemma);
  return forms
    .map((form) => ({
      surface: matchCasing(context.answerSurface, form),
      lemma: context.answerLemma,
      pos: context.expectedPos,
      source: "paradigm",
      tags: new Set(["paradigm"]),
      group: `paradigm:${context.answerLemma}`,
    }))
    .filter((candidate) => candidate.surface.toLowerCase() !== context.answerNormalized);
}

function generateCuratedConfusables(context) {
  const results = [];
  const answerLower = context.answerLemma;
  const seen = new Set();

  const pushCandidate = (word, { pos, group, tags = [] } = {}) => {
    if (!word) return;
    const lower = word.toLowerCase();
    if (lower === answerLower) return;
    if (seen.has(lower)) return;
    seen.add(lower);
    const tagSet = new Set(["curated"]);
    tags.forEach((tag) => tagSet.add(tag));
    results.push({
      surface: matchCasing(context.answerSurface, word),
      lemma: lower,
      pos: pos ?? context.expectedPos,
      source: "curated",
      tags: tagSet,
      group: group ?? `curated:${context.expectedPos ?? "misc"}`,
    });
  };

  if (context.gapMode === "grammar") {
    const slotInfo = context.slot;
    if (slotInfo?.domain === "TIME" && Array.isArray(confusables.timePreps)) {
      confusables.timePreps.forEach((word) =>
        pushCandidate(word, { pos: "FUNCTION", group: "curated:time-preps", tags: ["domain:time"] }),
      );
    }
    if (slotInfo?.domain === "PLACE" && Array.isArray(confusables.placePreps)) {
      confusables.placePreps.forEach((word) =>
        pushCandidate(word, { pos: "FUNCTION", group: "curated:place-preps", tags: ["domain:place"] }),
      );
    }

    for (const set of confusables.prepositionSets) {
      if (!Array.isArray(set)) continue;
      if (!set.includes(answerLower)) continue;
      set.forEach((word) => pushCandidate(word, { pos: "FUNCTION", group: "curated:prep-set" }));
    }

    if (Array.isArray(confusables.articles) && confusables.articles.includes(answerLower)) {
      confusables.articles.forEach((word) => pushCandidate(word, { pos: "FUNCTION", group: "curated:articles" }));
    }

    if (Array.isArray(confusables.auxiliaries) && confusables.auxiliaries.includes(answerLower)) {
      confusables.auxiliaries.forEach((word) => pushCandidate(word, { pos: "FUNCTION", group: "curated:aux" }));
    }

    return results;
  }

  const curatedSets = CURATED_SET_INDEX.get(context.expectedPos) ?? [];
  curatedSets.forEach((entry) => {
    if (!levelMatches(entry.levels, context.level)) return;
    if (!entry.wordsLower.includes(answerLower)) return;
    const tagList = entry.theme ? [`theme:${entry.theme}`] : [];
    entry.words.forEach((word) =>
      pushCandidate(word, {
        pos: context.expectedPos,
        group: `curated:${entry.id}`,
        tags: tagList,
      }),
    );
  });

  if (
    context.expectedPos === "VERB" &&
    Array.isArray(confusables.lightVerbs) &&
    confusables.lightVerbs.includes(answerLower)
  ) {
    confusables.lightVerbs.forEach((word) =>
      pushCandidate(word, { pos: "VERB", group: "light-verbs", tags: ["light-verb"] }),
    );
  }

  return results;
}

function fitsPosMorph(candidate, context) {
  if (context.gapMode === "grammar") {
    const expectedClass = classifyFunctionWord(context.answerSurface);
    return classifyFunctionWord(candidate.surface) === expectedClass;
  }
  if (context.expectedPos && candidate.pos && context.expectedPos !== candidate.pos) {
    return false;
  }
  if (context.expectedPos === "VERB") {
    const answerLower = context.answerSurface.toLowerCase();
    const candLower = candidate.surface.toLowerCase();
    if (answerLower.endsWith("ing")) return candLower.endsWith("ing");
    if (answerLower.endsWith("ed")) return candLower.endsWith("ed");
    if (answerLower.endsWith("s")) return candLower.endsWith("s");
  }
  return true;
}

function passesStopwordRule(candidate, context) {
  const lower = candidate.surface.toLowerCase();
  if (context.allowFunctionWords) {
    return true;
  }
  if (context.gapMode === "grammar") {
    return true;
  }
  return !STOPWORDS.has(lower);
}

function appearsInPrompt(candidate, context) {
  const lower = candidate.surface.toLowerCase();
  return context.promptLower.includes(` ${lower} `);
}

function isSameLemmaVariant(candidate, context) {
  return candidate.lemma.toLowerCase() === context.answerLemma;
}

function scoreCandidate(candidate, context, slot, collocationIndex, lemmaFreqMap) {
  let score = 0;
  if (candidate.tags?.has("family")) {
    score += 4;
  }
  if (candidate.tags?.has("colloc")) {
    score += 4;
  }
  if (slot.anchor && candidate.tags?.has("family")) {
    score += 1;
  }
  if (candidate.tags?.has("neighbor")) {
    score += 3;
  }
  if (candidate.tags?.has("paradigm")) {
    score += 2;
  }
  if (candidate.tags?.has("curated")) {
    score += 1;
  }

  // POS/morph confidence (binary after filters)
  score += 2;

  const answerFreq = context.answerFreq;
  const candidateFreq = lemmaFreqMap.get(candidate.lemma.toLowerCase());
  if (answerFreq != null && candidateFreq != null) {
    const diff = Math.abs(answerFreq - candidateFreq);
    score += Math.max(0, 1 - Math.min(diff / 2, 1));
  }

  const lev = levenshteinDistance(candidate.surface.toLowerCase(), context.answerSurface.toLowerCase());
  if (lev > 0 && lev <= 2) {
    score += 1;
  }

  return score;
}

function tieBreak(candidate, seed) {
  return deterministicHash(`${seed}|${candidate.surface.toLowerCase()}`);
}

function selectDiversifiedCandidates(candidates, limit, context, seed) {
  const selected = [];
  const lemmaSeen = new Set();
  const groupCounts = new Map();
  const sourceCounts = new Map();

  for (const item of candidates) {
    const candidate = item.candidate;
    const lemma = candidate.lemma.toLowerCase();
    if (context.gapMode !== "grammar" && lemmaSeen.has(lemma)) {
      continue;
    }
    const groupKey = candidate.group ?? `${candidate.source ?? "misc"}`;
    if (context.gapMode !== "grammar" && (groupCounts.get(groupKey) ?? 0) >= 1) {
      continue;
    }
    const sourceKey = candidate.source ?? "misc";
    if ((sourceCounts.get(sourceKey) ?? 0) >= 2) {
      continue;
    }
    selected.push(candidate);
    lemmaSeen.add(lemma);
    groupCounts.set(groupKey, (groupCounts.get(groupKey) ?? 0) + 1);
    sourceCounts.set(sourceKey, (sourceCounts.get(sourceKey) ?? 0) + 1);
    if (selected.length >= limit) {
      break;
    }
  }

  if (selected.length < limit) {
    const remaining = candidates
      .filter((item) => !selected.includes(item.candidate))
      .sort((a, b) => tieBreak(a.candidate, `${seed}|fallback`) - tieBreak(b.candidate, `${seed}|fallback`));
    for (const item of remaining) {
      selected.push(item.candidate);
      if (selected.length >= limit) break;
    }
  }

  return selected;
}

function buildSmartBank(context, collocationIndex, lemmaFreqMap, bankSize, seed) {
  const slot = inferSlot(context);
  context.slot = slot;
  const minBankSize = MIN_BANK_BY_LEVEL[context.level] ?? GAPFILL_BANK_MIN;
  const answerLower = context.answerSurface.toLowerCase();
  const candidateMap = new Map();

  const addCandidate = (candidate) => {
    const key = candidate.surface.toLowerCase();
    if (!key || key === answerLower) return;
    if (candidateMap.has(key)) return;
    const lemmaKey = (candidate.lemma ?? candidate.surface).toLowerCase();
    if (shouldThrottleCandidate(lemmaKey)) return;
    candidate.lemma = lemmaKey;
    candidate.pos = candidate.pos || guessPos(candidate.surface);
    candidate.tags = candidate.tags ?? new Set();
    candidate.group = candidate.group ?? `${candidate.source ?? "misc"}`;
    candidateMap.set(key, candidate);
  };

  getFamilyConfusables(context, slot).forEach(addCandidate);
  getPresetFamilyConfusables(context, slot).forEach(addCandidate);
  generateCollocationConfusables(context, collocationIndex).forEach(addCandidate);
  getDistributionNeighbors(context, collocationIndex).forEach(addCandidate);
  if (context.allowParadigm) {
    generateParadigmForms(context).forEach(addCandidate);
  }
  generateCuratedConfusables(context).forEach(addCandidate);

  let initialCandidates = Array.from(candidateMap.values()).filter((candidate) =>
    fitsPosMorph(candidate, context) &&
    passesStopwordRule(candidate, context) &&
    !appearsInPrompt(candidate, context) &&
    !isSameLemmaVariant(candidate, context),
  );

  const neededDistractors = Math.max(bankSize - 1 - initialCandidates.length, 0);
  let usedRelaxor = false;
  if (neededDistractors > 0) {
    const relaxed = relaxOnceIfNeeded(initialCandidates, context, neededDistractors, seed);
    if (relaxed.usedRelaxor) {
      initialCandidates = relaxed.candidates.filter((candidate) =>
        fitsPosMorph(candidate, context) &&
        passesStopwordRule(candidate, context) &&
        !appearsInPrompt(candidate, context) &&
        !isSameLemmaVariant(candidate, context),
      );
    } else {
      initialCandidates = relaxed.candidates;
    }
    usedRelaxor = relaxed.usedRelaxor;
  }

  const scored = initialCandidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(candidate, context, slot, collocationIndex, lemmaFreqMap),
      tie: tieBreak(candidate, seed),
    }))
    .sort((a, b) => {
      if (b.score === a.score) {
        return a.tie - b.tie;
      }
      return b.score - a.score;
    });

  const selected = selectDiversifiedCandidates(scored, Math.max(bankSize - 1, 1), context, seed);
  const surfaces = selected.map((candidate) => candidate.surface);
  const unique = [context.answerSurface, ...surfaces];
  const deduped = [];
  const seen = new Set();
  for (const value of unique) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(value);
    if (deduped.length >= bankSize) break;
  }

  if (!deduped.some((value) => value.toLowerCase() === answerLower)) {
    if (deduped.length >= bankSize) {
      deduped.pop();
    }
    deduped.push(context.answerSurface);
  }

  if (deduped.length > 1) {
    const targetIndex = deduped.findIndex((value) => value.toLowerCase() === answerLower);
    if (targetIndex >= 0) {
      const repositionSeed = deterministicHash(`${seed}|answer-slot`);
      const swapIndex = repositionSeed % deduped.length;
      if (swapIndex !== targetIndex) {
        [deduped[targetIndex], deduped[swapIndex]] = [deduped[swapIndex], deduped[targetIndex]];
      }
    }
  }

  updateCooldown(selected);

  const tags = new Set();
  selected.forEach((candidate) => candidate.tags?.forEach((tag) => tags.add(tag)));
  if (usedRelaxor) {
    tags.add("relaxed");
  }
  const tagList = Array.from(tags.values()).sort();
  const quality = qualityLabel({
    bank: deduped,
    tags,
    usedRelaxor,
    minSize: minBankSize,
  });

  const meta = {
    tags: tagList,
    slot: slotSignature(slot),
    size: deduped.length,
    usedRelax: usedRelaxor,
  };
  if (context.presetId) {
    meta.preset = context.presetId;
  }
  if (context.extraFamilies && context.extraFamilies.length > 0) {
    meta.extraFamilies = context.extraFamilies;
  }

  return { bank: deduped, quality, meta };
}

function getCollocationEntries(card) {
  if (!card) return [];
  const entries = [];
  const source = card.collocations;
  if (Array.isArray(source)) {
    for (const entry of source) {
      if (!entry) continue;
      const partner = typeof entry.partner === "string" ? entry.partner.trim() : "";
      if (!partner) continue;
      entries.push({
        anchor: typeof entry.anchor === "string" && entry.anchor ? entry.anchor : card.lemma,
        partner,
        score: typeof entry.score === "number" ? entry.score : null,
        slot:
          typeof entry.slot === "string"
            ? entry.slot.toUpperCase()
            : typeof card.pos === "string"
              ? card.pos.toUpperCase()
              : "",
      });
    }
    return entries;
  }

  if (source && typeof source === "object") {
    for (const value of Object.values(source)) {
      if (!Array.isArray(value)) continue;
      for (const partner of value) {
        if (typeof partner !== "string") continue;
        const trimmed = partner.trim();
        if (!trimmed) continue;
        entries.push({
          anchor: card.lemma,
          partner: trimmed,
          score: null,
          slot: typeof card.pos === "string" ? card.pos.toUpperCase() : "",
        });
      }
    }
  }

  return entries;
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

function countBlanks(prompt) {
  return (prompt.match(/_____/g) ?? []).length;
}

function buildGapfillRows({
  cards,
  level,
  limit,
  filterConfig,
  collocationIndex,
  lemmaFreqMap,
  maxBlanksPerSentence,
  preset,
}) {
  packCooldown.clear();
  const rows = [];
  const seenPrompts = new Set();
  const bankTelemetry = createBankTelemetry();
  const gapfillPreset =
    preset && Array.isArray(preset.exerciseTypes) && preset.exerciseTypes.includes("gapfill")
      ? preset
      : null;
  const presetGapFillConfig = gapfillPreset?.gapFill ?? null;
  const presetGapfillBuilder = gapfillPreset?.builder?.gapfill ?? null;
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
  const blanksLimit = presetGapFillConfig?.maxBlanksPerSentence ?? maxBlanksPerSentence;

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

    const originalSentence = cloze.sentence ?? card.examples[0] ?? "";
    const unsafeReason = checkUnsafeText(originalSentence, filterConfig, dropSummary);
    if (unsafeReason) {
      stats.filteredByGuards += 1;
      continue;
    }

    const tokens = cloze.tokens ?? tokenizeSentence(originalSentence);
    let targetIndex = cloze.targetIndex ?? -1;
    if (targetIndex < 0) {
      const lowerAnswer = cloze.answer.toLowerCase();
      targetIndex = tokens.findIndex((token) => token.surface.toLowerCase() === lowerAnswer);
    }

    const surfaceReason = evaluateSurface({
      surface: cloze.answer,
      tokens,
      index: targetIndex >= 0 ? targetIndex : 0,
      sentence: originalSentence,
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
    const blanksCount = countBlanks(cloze.prompt);
    if (blanksLimit && blanksCount > blanksLimit) {
      continue;
    }
    if (seenPrompts.has(normalized)) {
      stats.droppedDuplicate += 1;
      continue;
    }

    seenPrompts.add(normalized);
    const answers = [cloze.answer];
    const sentenceLower = ` ${originalSentence.toLowerCase()} `;
    const promptLower = ` ${cloze.prompt.toLowerCase()} `;
    let gapMode = determineGapMode({ answer: cloze.answer, card, sentenceLower });
    const enforcedMode = presetGapfillBuilder?.enforceMode;
    if (enforcedMode) {
      gapMode = enforcedMode;
    }
    let expectedPos = typeof card.pos === "string" ? card.pos.toUpperCase() : guessPos(cloze.answer);
    if (gapMode === "grammar") {
      expectedPos = "FUNCTION";
    }
    const answerLemma = (typeof card.lemma === "string" ? card.lemma : cloze.answer).toLowerCase();
    const bankSeed = `gapfill|bank|${card.lemma}|${normalized}`;
    const desiredBankSize = clampBankSize(
      presetGapFillConfig?.bankSize ?? BANK_DEFAULT_BY_LEVEL[level] ?? GAPFILL_BANK_DEFAULT_SIZE,
    );
    const allowFunctionWords = gapMode === "grammar" || presetGapfillBuilder?.allowFunctionWords === true;
    const extraFamilies = Array.isArray(presetGapfillBuilder?.extraFamilies)
      ? presetGapfillBuilder.extraFamilies.filter((key) => typeof key === "string" && key.length > 0)
      : [];
    const context = {
      answerSurface: cloze.answer,
      answerLemma,
      answerNormalized: normalizeToken(cloze.answer),
      answerFreq: lemmaFreqMap.get(answerLemma) ?? null,
      expectedPos,
      gapMode,
      tokens,
      targetIndex: targetIndex >= 0 ? targetIndex : 0,
      sentenceLower,
      promptLower,
      cardCollocations: getCollocationEntries(card),
      allowParadigm: gapMode === "grammar" || expectedPos === "VERB",
      blanksCount,
      maxBlanksPerSentence: blanksLimit,
      level,
      allowFunctionWords,
      extraFamilies,
      presetId: gapfillPreset?.id ?? null,
    };
    const { bank, quality, meta } = buildSmartBank(
      context,
      collocationIndex,
      lemmaFreqMap,
      desiredBankSize,
      bankSeed,
    );

    const presetForTelemetry = typeof meta.preset === "string" ? meta.preset : context.presetId;
    recordBankTelemetry(bankTelemetry, {
      level,
      presetId: presetForTelemetry,
      tags: new Set(Array.isArray(meta.tags) ? meta.tags : []),
      bankSize: bank.length,
      usedRelax: meta.usedRelax === true,
    });

    const hintsParts = [];
    const hintConfig = presetGapFillConfig?.hints;
    const includeInitial = hintConfig ? hintConfig.initialLetter === true : true;
    const includePos = hintConfig ? hintConfig.pos === true : Boolean(card.pos);
    const includeCue = hintConfig ? hintConfig.collocationCue === true : true;
    const includeTts = hintConfig ? hintConfig.tts === true : false;
    const initialHint = cloze.answer.charAt(0);
    if (includeInitial && initialHint) {
      hintsParts.push(`first=${initialHint}`);
    }
    if (includePos && card.pos) {
      hintsParts.push(`pos=${card.pos}`);
    }
    const tokenVariants = context.tokens.map((token, index) => ({
      lower: token.surface?.toLowerCase() ?? "",
      normalized: normalizeTokenLower(token.surface ?? ""),
      index,
    }));
    const matchesPromptToken = (candidateLower) =>
      tokenVariants.some((token) => {
        if (token.index === context.targetIndex || !candidateLower) return false;
        return (
          tokenMatchesCollocationVariant(token.lower, candidateLower) ||
          tokenMatchesCollocationVariant(token.normalized, candidateLower)
        );
      });
    const collocationCueEntry = context.cardCollocations.find((entry) => {
      if (!entry) return false;
      const anchorLower = (entry.anchor ?? "").toLowerCase();
      const partnerLower = (entry.partner ?? "").toLowerCase();
      if (anchorLower === context.answerLemma && partnerLower) {
        return matchesPromptToken(partnerLower);
      }
      if (partnerLower === context.answerLemma && anchorLower) {
        return matchesPromptToken(anchorLower);
      }
      return false;
    });
    let collocationCue = null;
    if (collocationCueEntry) {
      if ((collocationCueEntry.anchor ?? "").toLowerCase() === context.answerLemma) {
        collocationCue = collocationCueEntry.partner;
      } else if ((collocationCueEntry.partner ?? "").toLowerCase() === context.answerLemma) {
        collocationCue = collocationCueEntry.anchor;
      }
    }
    if (!collocationCue && includeCue && context.gapMode === "collocation") {
      collocationCue = deriveNeighborCue(context);
    }
    if (includeCue && collocationCue) {
      hintsParts.push(`cue=${collocationCue}`);
    }
    if (includeTts) {
      hintsParts.push("tts=1");
    }

    rows.push([
      level,
      "gapfill",
      cloze.prompt,
      answers.join("|"),
      cloze.answer,
      card.source ?? SOURCE_FALLBACK,
      card.license ?? LICENSE_FALLBACK,
      gapMode,
      bank.join("|"),
      hintsParts.join(";"),
      quality,
      JSON.stringify(meta),
    ]);
    stats.emitted += 1;
    if (limit && rows.length >= limit) break;
  }

  return { rows, stats, dropSummary, telemetry: serializeBankTelemetry(bankTelemetry) };
}

function buildMatchingRows({ cards, level, limit, filterConfig }) {
  const rows = [];
  const stats = {
    matchingMode: "pair",
    pairsEmitted: 0,
    pairsFilteredByGuards: 0,
    skippedNoPairs: 0,
    droppedDuplicate: 0,
  };
  const dropSummary = {};

  const lemmaBuckets = new Map();
  let cardsWithoutPairs = 0;

  for (const card of cards) {
    if (!card || typeof card.lemma !== "string") {
      continue;
    }
    const lemma = card.lemma;
    const entries = getCollocationEntries(card);
    if (entries.length === 0) {
      cardsWithoutPairs += 1;
      continue;
    }

    const bucket = lemmaBuckets.get(lemma) ?? [];
    const seenValues = new Set(bucket.map((candidate) => candidate.value.toLowerCase()));
    for (const entry of entries) {
      const value = typeof entry.partner === "string" ? entry.partner.trim() : "";
      if (!value) continue;
      const normalized = value.toLowerCase();
      if (seenValues.has(normalized)) continue;
      seenValues.add(normalized);
      bucket.push({
        value,
        source: card.source ?? SOURCE_FALLBACK,
        license: card.license ?? LICENSE_FALLBACK,
      });
    }

    if (bucket.length > 0) {
      lemmaBuckets.set(lemma, bucket);
    } else {
      cardsWithoutPairs += 1;
    }
  }

  const lemmaList = Array.from(lemmaBuckets.keys()).sort((a, b) => a.localeCompare(b));
  if (lemmaList.length === 0) {
    return { rows, stats, dropSummary };
  }

  const shuffledLemmas = deterministicShuffle(lemmaList, `matching|pair|${level}`);
  const seenPairs = new Set();
  let limitReached = false;

  for (const lemma of shuffledLemmas) {
    if (limitReached) break;
    const bucket = lemmaBuckets.get(lemma);
    if (!bucket || bucket.length === 0) continue;
    const shuffledCandidates = deterministicShuffle(
      bucket,
      `matching|pair|${level}|${lemma}`,
    );
    for (const candidate of shuffledCandidates) {
      const collocate = candidate.value;
      if (!collocate) {
        continue;
      }

      const tokens = [
        { surface: "the", normalized: "the", index: 0 },
        { surface: collocate, normalized: normalizeToken(collocate), index: 1 },
        { surface: lemma, normalized: normalizeToken(lemma), index: 2 },
      ];
      const sentence = `the ${collocate} ${lemma}`;

      const surfaceLeft = evaluateSurface({
        surface: collocate,
        tokens,
        index: 1,
        sentence,
        filterConfig,
        dropSummary,
      });
      if (surfaceLeft) {
        stats.pairsFilteredByGuards += 1;
        continue;
      }

      const surfaceRight = evaluateSurface({
        surface: lemma,
        tokens,
        index: 2,
        sentence,
        filterConfig,
        dropSummary,
      });
      if (surfaceRight) {
        stats.pairsFilteredByGuards += 1;
        continue;
      }

      const unsafeReason = checkUnsafeText(sentence, filterConfig, dropSummary);
      if (unsafeReason) {
        stats.pairsFilteredByGuards += 1;
        continue;
      }

      const pairKey = normalizePair(collocate, lemma);
      if (seenPairs.has(pairKey)) {
        stats.droppedDuplicate += 1;
        continue;
      }
      seenPairs.add(pairKey);

      rows.push([
        level,
        "matching",
        collocate,
        lemma,
        candidate.source ?? SOURCE_FALLBACK,
        candidate.license ?? LICENSE_FALLBACK,
        "",
      ]);
      stats.pairsEmitted += 1;

      if (limit && rows.length >= limit) {
        limitReached = true;
        break;
      }
    }
  }

  stats.skippedNoPairs = cardsWithoutPairs;
  stats.emitted = stats.pairsEmitted;
  stats.filteredByGuards = stats.pairsFilteredByGuards;

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

function buildScrambleRows({ cards, level, limit, filterConfig }) {
  const rows = [];
  const stats = {
    emitted: 0,
    skippedShort: 0,
    skippedNumeric: 0,
    filteredByGuards: 0,
    droppedDuplicate: 0,
  };
  const dropSummary = {};
  const seenPrompts = new Set();

  outer: for (const card of cards) {
    if (!Array.isArray(card.examples) || card.examples.length === 0) {
      continue;
    }
    for (let exampleIndex = 0; exampleIndex < card.examples.length; exampleIndex += 1) {
      const sentence = card.examples[exampleIndex];
      if (!sentence || typeof sentence !== "string") {
        continue;
      }
      const trimmed = sentence.trim();
      if (trimmed.length < GAPFILL_MIN_LENGTH) {
        stats.skippedShort += 1;
        continue;
      }
      if (/\d/.test(trimmed)) {
        stats.skippedNumeric += 1;
        recordDrop(dropSummary, "numeric", trimmed.slice(0, 160));
        continue;
      }
      const unsafe = checkUnsafeText(trimmed, filterConfig, dropSummary);
      if (unsafe) {
        stats.filteredByGuards += 1;
        continue;
      }
      const tokens = tokenizeSentence(trimmed);
      if (!Array.isArray(tokens) || tokens.length < 4) {
        stats.skippedShort += 1;
        continue;
      }
      const surfaces = tokens.map((token) => token.surface);
      const seed = `scramble|${level}|${card.lemma}|${exampleIndex}`;
      const shuffled = deterministicShuffle(surfaces, seed);
      const prompt = shuffled.join(" ");
      const normalized = normalizePrompt(prompt);
      if (seenPrompts.has(normalized)) {
        stats.droppedDuplicate += 1;
        continue;
      }
      seenPrompts.add(normalized);
      rows.push([
        level,
        "scramble",
        prompt,
        trimmed,
        card.source ?? SOURCE_FALLBACK,
        card.license ?? LICENSE_FALLBACK,
      ]);
      stats.emitted += 1;
      if (limit && rows.length >= limit) {
        break outer;
      }
    }
  }

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

function logSummary({ gapfill, matching, mcq, scramble, outputDir }, extras = {}) {
  const summary = {
    task: "cards-to-packs",
    outputDir,
    gapfill,
    matching,
    mcq,
    scramble,
  };
  Object.assign(summary, extras);
  console.log(JSON.stringify(summary, null, 2));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const levelRaw = opts.get("--level") ?? "A2";
  const level = String(levelRaw).toUpperCase();
  const cardsPath = opts.get("--cards")
    ? path.resolve(opts.get("--cards"))
    : path.resolve(process.cwd(), `cards/draft_cards_${level}.jsonl`);
  const outDir = opts.get("--outDir")
    ? path.resolve(opts.get("--outDir"))
    : path.resolve(process.cwd(), `public/packs/${level}`);
  const presetId = opts.get("--preset") ?? null;
  const preset = getPresetDefinition(presetId);
  if (presetId && !preset) {
    console.warn(`Preset '${presetId}' not found in library; proceeding without preset hints.`);
  }

  const limitGapfill = toNumber(opts.get("--limitGapfill")) ?? 0;
  const limitMatching = toNumber(opts.get("--limitMatching")) ?? 0;
  const limitMcq = toNumber(opts.get("--limitMcq")) ?? 0;
  const limitScramble = toNumber(opts.get("--limitScramble")) ?? 0;
  const sfwLevelRaw = opts.get("--sfwLevel") ? String(opts.get("--sfwLevel")).toLowerCase() : null;
  if (opts.has("--sfw")) {
    console.warn("`--sfw` is no longer supported. Use --sfwLevel <off|default|strict> instead.");
  }
  let sfwLevel = sfwLevelRaw;
  if (!sfwLevel || !["off", "default", "strict"].includes(sfwLevel)) {
    sfwLevel = "strict";
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
        limitScramble: limitScramble || null,
        sfwLevel,
        dropProperNouns,
        acronymMinLen,
      preset: preset?.id ?? null,
    },
    null,
    2,
  ),
  );

  const cards = await loadCards(cardsPath);

  const lemmaFreqMap = buildLemmaFreqMap(cards);
  const collocationIndex = buildCollocationIndex(cards);

  const combinedDropSummary = {};

  const gapfill = buildGapfillRows({
    cards,
    level,
    limit: limitGapfill,
    filterConfig,
    collocationIndex,
    lemmaFreqMap,
    maxBlanksPerSentence: MAX_BLANKS_BY_LEVEL[level] ?? 2,
    preset,
  });
  mergeDropSummaries(combinedDropSummary, gapfill.dropSummary);
  await writeCsv(
    path.join(outDir, "gapfill.csv"),
    [
      "level",
      "type",
      "prompt",
      "answers",
      "answer",
      "source",
      "license",
      "gap_mode",
      "bank",
      "hints",
      "bank_quality",
      "bank_meta",
    ],
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

  const scramble = buildScrambleRows({ cards, level, limit: limitScramble, filterConfig });
  mergeDropSummaries(combinedDropSummary, scramble.dropSummary);
  await writeCsv(
    path.join(outDir, "scramble.csv"),
    ["level", "type", "prompt", "answer", "source", "license"],
    scramble.rows,
  );

  const summaryExtras = buildSummaryFragment(combinedDropSummary);
  summaryExtras.sfwLevel = filterConfig.sfwLevel;
  summaryExtras.matchingMode = "pair";
  summaryExtras.pairsEmitted = matching.stats.pairsEmitted;
  summaryExtras.pairsFilteredByGuards = matching.stats.pairsFilteredByGuards;
  summaryExtras.scrambleEmitted = scramble.stats.emitted;
  summaryExtras.preset = preset?.id ?? null;
  summaryExtras.bankTelemetry = gapfill.telemetry ?? null;

  logSummary({
    gapfill: gapfill.stats,
    matching: matching.stats,
    mcq: mcq.stats,
    scramble: scramble.stats,
    outputDir: outDir,
  }, summaryExtras);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
