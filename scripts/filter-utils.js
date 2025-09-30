import { promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_BLOCKLIST = [
  "rape",
  "gang rape",
  "molest",
  "pedo",
  "suicide",
  "kill yourself",
  "lynch",
  "genocide",
  "holocaust",
  "nazi",
];

const DEFAULT_ACRONYM_ALLOW = ["UK", "US", "EU", "UN", "USA", "NATO", "BBC", "NBA"];

const DEFAULT_PROPER_CONTEXT = [
  "republic",
  "kingdom",
  "empire",
  "isle",
  "isles",
  "mount",
  "mountain",
  "lake",
  "river",
  "university",
  "college",
  "academy",
  "institute",
  "city",
  "county",
  "province",
  "state",
  "league",
  "brigade",
  "dynasty",
  "war",
  "battle",
  "treaty",
  "cup",
  "olympics",
  "stadium",
  "arena",
  "church",
  "cathedral",
  "palace",
  "park",
  "bay",
  "ocean",
  "sea",
  "gulch",
  "harbor",
  "harbour",
  "strait",
  "canal",
  "peninsula",
  "airport",
  "airfield",
  "space",
  "mission",
  "fleet",
  "brigade",
  "division",
  "corps",
  "army",
  "navy",
  "united",
  "federation",
  "conference",
  "revolution",
  "republic",
  "council",
  "assembly",
  "senate",
  "parliament",
  "academy",
  "opera",
  "festival",
];

const DEFAULT_NATIONALITIES = [
  "afghan",
  "african",
  "albanian",
  "algerian",
  "american",
  "andorran",
  "angolan",
  "argentine",
  "argentinian",
  "armenian",
  "australian",
  "austrian",
  "azerbaijani",
  "bangladeshi",
  "belarusian",
  "belgian",
  "belizean",
  "beninese",
  "bhutanese",
  "bolivian",
  "bosnian",
  "brazilian",
  "british",
  "bulgarian",
  "burmese",
  "burundian",
  "cambodian",
  "cameroonian",
  "canadian",
  "capeverdean",
  "chadian",
  "chilean",
  "chinese",
  "colombian",
  "comorian",
  "congolese",
  "costa rican",
  "croatian",
  "cuban",
  "cypriot",
  "czech",
  "danish",
  "djiboutian",
  "dominican",
  "dutch",
  "ecuadorian",
  "egyptian",
  "emirati",
  "english",
  "estonian",
  "ethiopian",
  "fijian",
  "filipino",
  "finnish",
  "french",
  "gabonese",
  "gambian",
  "georgian",
  "german",
  "ghanaian",
  "greek",
  "guatemalan",
  "guinean",
  "guyanese",
  "haitian",
  "honduran",
  "hungarian",
  "icelandic",
  "indian",
  "indonesian",
  "iranian",
  "iraqi",
  "irish",
  "israeli",
  "italian",
  "ivorian",
  "jamaican",
  "japanese",
  "jordanian",
  "kazakh",
  "kenyan",
  "korean",
  "kuwaiti",
  "kyrgyz",
  "laotian",
  "latvian",
  "lebanese",
  "liberian",
  "libyan",
  "liechtensteiner",
  "lithuanian",
  "luxembourgish",
  "macedonian",
  "malagasy",
  "malawian",
  "malaysian",
  "maldivian",
  "malian",
  "maltese",
  "mauritanian",
  "mauritian",
  "mexican",
  "moldovan",
  "monacan",
  "mongolian",
  "montenegrin",
  "moroccan",
  "mozambican",
  "myanmarese",
  "namibian",
  "nepalese",
  "new zealander",
  "nicaraguan",
  "nigerian",
  "nigerien",
  "norwegian",
  "omani",
  "pakistani",
  "palestinian",
  "panamanian",
  "papuan",
  "paraguayan",
  "peruvian",
  "polish",
  "portuguese",
  "qatari",
  "romanian",
  "russian",
  "rwandan",
  "saudi",
  "scottish",
  "senegalese",
  "serbian",
  "singaporean",
  "slovak",
  "slovenian",
  "somali",
  "south african",
  "spanish",
  "sri lankan",
  "sudanese",
  "surinamese",
  "swazi",
  "swedish",
  "swiss",
  "syrian",
  "taiwanese",
  "tajik",
  "tanzanian",
  "thai",
  "togolese",
  "tongan",
  "trinidadian",
  "tunisian",
  "turkish",
  "turkmen",
  "ugandan",
  "ukrainian",
  "uruguayan",
  "uzbek",
  "venezuelan",
  "vietnamese",
  "welsh",
  "yemeni",
  "zambian",
  "zimbabwean",
];

export async function loadListFile(filePath, defaults = []) {
  if (!filePath) {
    return defaults;
  }
  try {
    const content = await fs.readFile(filePath, "utf8");
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
  } catch (error) {
    return defaults;
  }
}

export async function buildFilterConfig({
  cwd = process.cwd(),
  blockListPath,
  allowListPath,
  properListPath,
  nationalitiesPath,
  acronymMinLen = 3,
  dropProperNouns = true,
  sfw = true,
}) {
  const resolveMaybe = (maybePath, fallback) => {
    if (maybePath) return path.resolve(cwd, maybePath);
    if (!fallback) return null;
    return path.resolve(cwd, fallback);
  };

  const blocklist = await loadListFile(
    resolveMaybe(blockListPath, "filter-lists/blocklist.txt"),
    DEFAULT_BLOCKLIST,
  );
  const allowlist = await loadListFile(
    resolveMaybe(allowListPath, "filter-lists/acronyms-allowed.txt"),
    DEFAULT_ACRONYM_ALLOW,
  );
  const properList = await loadListFile(
    resolveMaybe(properListPath, "filter-lists/proper-context.txt"),
    DEFAULT_PROPER_CONTEXT,
  );
  const nationalityList = await loadListFile(
    resolveMaybe(nationalitiesPath, "filter-lists/nationalities.txt"),
    DEFAULT_NATIONALITIES,
  );

  return {
    blocklist: blocklist.map((term) => term.toLowerCase()),
    allowlist: new Set(allowlist.map((term) => term.trim().toUpperCase())),
    properContext: new Set(properList.map((term) => term.toLowerCase())),
    nationalities: new Set(nationalityList.map((term) => term.toLowerCase())),
    acronymMinLen: Number.isFinite(acronymMinLen) ? acronymMinLen : 3,
    dropProperNouns,
    sfw,
  };
}

export function normalizeToken(value) {
  if (!value) return "";
  return String(value).toLowerCase().replace(/[^a-z]+/g, "");
}

export function isOrdinal(value) {
  if (!value) return false;
  const lower = value.toLowerCase();
  const textual = new Set([
    "first",
    "second",
    "third",
    "fourth",
    "fifth",
    "sixth",
    "seventh",
    "eighth",
    "ninth",
    "tenth",
    "eleventh",
    "twelfth",
    "thirteenth",
    "fourteenth",
    "fifteenth",
    "sixteenth",
    "seventeenth",
    "eighteenth",
    "nineteenth",
    "twentieth",
  ]);
  if (textual.has(lower)) return true;
  return /^\d+(st|nd|rd|th)$/i.test(value);
}

export function isAcronym(value, minLen = 3, allowlist = new Set()) {
  if (!value) return false;
  const clean = value.replace(/[^A-Za-z]/g, "");
  if (allowlist.has(clean)) return false;
  if (clean.length === 0) return false;
  if (clean === clean.toUpperCase() && clean.length <= minLen && clean.length >= 2) {
    return true;
  }
  return false;
}

export function isFormulaArtifact(value) {
  if (!value) return false;
  return /formula_\d+/i.test(value);
}

export function isUnsafe(text, blocklist = [], sfw = true) {
  if (!sfw) return false;
  if (!text) return false;
  const lower = text.toLowerCase();
  return blocklist.some((term) => lower.includes(term));
}

export function requiresCapitalization(entry) {
  if (!entry || !entry.caseStats) return false;
  const { lower = 0, capital = 0, upper = 0 } = entry.caseStats;
  const total = lower + capital + upper;
  if (total === 0) return false;
  const ratio = (capital + upper) / total;
  return ratio > 0.4;
}

export function dominantProperNoun(entry) {
  if (!entry || !entry.rawPosCounts) return false;
  let total = 0;
  let proper = 0;
  for (const [pos, count] of entry.rawPosCounts.entries()) {
    total += count;
    if (pos === "PROPN") {
      proper += count;
    }
  }
  if (total === 0) return false;
  return proper / total > 0.5;
}

export function isCapitalized(surface) {
  if (!surface) return false;
  const first = surface[0];
  if (first !== first.toUpperCase() || first === first.toLowerCase()) return false;
  return true;
}

export function isProperContext(tokens, index, properSet, nationalitySet) {
  if (!tokens || tokens.length === 0) return false;
  const start = Math.max(0, index - 3);
  const end = Math.min(tokens.length, index + 4);
  const determiners = new Set(["the", "a", "an"]);
  for (let i = start; i < end; i += 1) {
    if (i === index) continue;
    const token = tokens[i];
    const norm = token.normalized;
    if (!norm) continue;
    if (properSet.has(norm) || nationalitySet.has(norm)) {
      return true;
    }
  }
  if (index >= 2) {
    const prev = tokens[index - 1];
    const prevPrev = tokens[index - 2];
    if (
      prevPrev && determiners.has(prevPrev.normalized) &&
      prev && isCapitalized(prev.surface) &&
      tokens[index] && isCapitalized(tokens[index].surface)
    ) {
      return true;
    }
  }
  if (index + 1 < tokens.length) {
    const next = tokens[index + 1];
    if (next && (properSet.has(next.normalized) || nationalitySet.has(next.normalized))) {
      return true;
    }
  }
  return false;
}

export function isProperNounLike({
  entry,
  surface,
  tokens,
  index,
  sentenceInitial,
  properSet,
  nationalitySet,
  config,
}) {
  if (!config?.dropProperNouns) return false;
  if (isFormulaArtifact(surface)) return true;
  const surfaceValue = surface ?? "";
  const isAllCaps = /^[A-Z]{2,}$/.test(surfaceValue);
  const isTitleCase = /^[A-Z][a-z'’\-]+$/.test(surfaceValue);
  const ordinal = isOrdinal(surfaceValue);
  const context = isProperContext(tokens, index, properSet, nationalitySet);
  if (!sentenceInitial && (isTitleCase || isAllCaps)) {
    return true;
  }
  if (ordinal && context) {
    return true;
  }
  if (isAllCaps && !config.allowlist?.has(surfaceValue)) {
    return true;
  }
  if (context && (isTitleCase || ordinal || isAllCaps)) {
    return true;
  }
  if (dominantProperNoun(entry)) {
    return true;
  }
  if (requiresCapitalization(entry)) {
    return true;
  }
  return false;
}

export function tokenizeSentence(sentence) {
  const matches = sentence.matchAll(/[A-Za-z'’\-]+/g);
  const tokens = [];
  for (const match of matches) {
    tokens.push({
      surface: match[0],
      normalized: normalizeToken(match[0]),
      index: match.index ?? 0,
    });
  }
  return tokens;
}

export function resolveSurfacePos(surface, surfacePosCounts) {
  if (!surface || !surfacePosCounts) return "";
  const posCounts = surfacePosCounts.get(surface);
  if (!posCounts) return "";
  let bestPos = "";
  let bestScore = -Infinity;
  for (const [pos, count] of posCounts.entries()) {
    if (count > bestScore) {
      bestScore = count;
      bestPos = pos;
    }
  }
  return bestPos;
}

export function recordDrop(summary, key, sample) {
  if (!summary[key]) {
    summary[key] = { count: 0, samples: [] };
  }
  summary[key].count += 1;
  if (summary[key].samples.length < 5 && sample) {
    summary[key].samples.push(sample);
  }
}

export function buildSummaryFragment(summary) {
  const fragment = {};
  for (const [key, value] of Object.entries(summary)) {
    fragment[`dropped${capitalize(key)}`] = value.count;
    fragment[`dropped${capitalize(key)}Samples`] = value.samples;
  }
  return fragment;
}

export function mergeDropSummaries(target, source) {
  if (!source) return target;
  for (const [key, value] of Object.entries(source)) {
    if (!value) continue;
    if (!target[key]) {
      target[key] = { count: 0, samples: [] };
    }
    target[key].count += value.count ?? 0;
    for (const sample of value.samples ?? []) {
      if (target[key].samples.length < 5) {
        target[key].samples.push(sample);
      }
    }
  }
  return target;
}

function capitalize(value) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function isTooShortAnswer(answer, allowTwoLetter = new Set(["an", "of", "to"])) {
  if (!answer) return true;
  const trimmed = answer.trim();
  const clean = trimmed.replace(/[^A-Za-z]/g, "");
  if (clean.length >= 3 && clean.length <= 20) {
    return false;
  }
  if (clean.length === 2 && allowTwoLetter.has(clean.toLowerCase())) {
    return false;
  }
  return true;
}

export function lemmaCaseShare(entry) {
  if (!entry || !entry.caseStats) return 0;
  const { lower = 0 } = entry.caseStats;
  const { lower: lowerCount = 0, capital = 0, upper = 0 } = entry.caseStats;
  const total = lowerCount + capital + upper;
  if (total === 0) return 0;
  return lowerCount / total;
}
