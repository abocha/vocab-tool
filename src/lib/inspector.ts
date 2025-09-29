import type {
  ExerciseItem,
  ExerciseType,
  GapFillItem,
  InspectorFilters,
  Level,
  MatchingItem,
  MatchingPair,
  McqItem,
  ScrambleItem,
} from "../types";

function csvEscape(value: string): string {
  const safeValue = value == null ? "" : String(value);
  if (/[",\n]/.test(safeValue)) {
    return `"${safeValue.replace(/"/g, '""')}"`;
  }
  return safeValue;
}

function cleanWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function getGapFillText(item: GapFillItem): string {
  return `${item.prompt} ${item.answer}`;
}

function getMatchingText(item: MatchingItem): string {
  return item.pairs
    .map((pair: MatchingPair) => `${pair.left} ${pair.right}`)
    .join(" ");
}

function getMcqText(item: McqItem): string {
  return `${item.prompt} ${item.options.join(" ")} ${item.answer}`;
}

function getScrambleText(item: ScrambleItem): string {
  return `${item.prompt} ${item.answer}`;
}

export function itemToPlainText(item: ExerciseItem): string {
  switch (item.type) {
    case "gapfill":
      return getGapFillText(item);
    case "matching":
      return getMatchingText(item);
    case "mcq":
      return getMcqText(item);
    case "scramble":
      return getScrambleText(item);
    default:
      return "";
  }
}

export function itemLength(item: ExerciseItem): number {
  const plain = cleanWhitespace(itemToPlainText(item));
  return plain.length;
}

export function applyInspectorFilters(
  items: ExerciseItem[],
  filters: InspectorFilters,
  hiddenIds: Set<string>,
): ExerciseItem[] {
  const contains = filters.contains.trim().toLowerCase();
  const min = filters.minLength ?? null;
  const max = filters.maxLength ?? null;

  return items.filter((item) => {
    if (hiddenIds.has(item.id)) {
      return false;
    }
    const plain = cleanWhitespace(itemToPlainText(item));
    const length = plain.length;

    if (contains && !plain.toLowerCase().includes(contains)) {
      return false;
    }
    if (min !== null && length < min) {
      return false;
    }
    if (max !== null && length > max) {
      return false;
    }
    return true;
  });
}

function buildGapFillCsv(items: GapFillItem[], level: Level): string {
  const header = "level,type,prompt,answer,source,license";
  const rows = items.map((item) => {
    const cells = [
      item.level ?? level,
      item.type,
      item.prompt,
      item.answer,
      item.source ?? "",
      item.license ?? "",
    ];
    return cells.map(csvEscape).join(",");
  });
  return [header, ...rows].join("\n");
}

function buildMatchingCsv(items: MatchingItem[], level: Level): string {
  const header = "level,type,left,right,source,license,count";
  const rows = items.map((item) => {
    const left = item.pairs.map((pair) => pair.left).join("|");
    const right = item.pairs.map((pair) => pair.right).join("|");
    const cells = [
      item.level ?? level,
      item.type,
      left,
      right,
      item.source ?? "",
      item.license ?? "",
      String(item.pairs.length),
    ];
    return cells.map(csvEscape).join(",");
  });
  return [header, ...rows].join("\n");
}

function buildMcqCsv(items: McqItem[]): string {
  const header = "type,prompt,options,answer,source,license";
  const rows = items.map((item) => {
    const cells = [
      item.type,
      item.prompt,
      item.options.join("|"),
      item.answer,
      item.source ?? "",
      item.license ?? "",
    ];
    return cells.map(csvEscape).join(",");
  });
  return [header, ...rows].join("\n");
}

function buildScrambleCsv(items: ScrambleItem[], level: Level): string {
  const header = "level,type,prompt,answer,source,license";
  const rows = items.map((item) => {
    const cells = [
      item.level ?? level,
      item.type,
      item.prompt,
      item.answer,
      item.source ?? "",
      item.license ?? "",
    ];
    return cells.map(csvEscape).join(",");
  });
  return [header, ...rows].join("\n");
}

export function buildCsvExport(
  items: ExerciseItem[],
  type: ExerciseType,
  level: Level,
): { csv: string; filename: string } | null {
  if (items.length === 0) {
    return null;
  }

  let csv = "";
  switch (type) {
    case "gapfill":
      csv = buildGapFillCsv(items as GapFillItem[], level);
      break;
    case "matching":
      csv = buildMatchingCsv(items as MatchingItem[], level);
      break;
    case "mcq":
      csv = buildMcqCsv(items as McqItem[]);
      break;
    case "scramble":
      csv = buildScrambleCsv(items as ScrambleItem[], level);
      break;
    default:
      return null;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${level}-${type}-curated-${timestamp}.csv`;
  return { csv: `${csv}\n`, filename };
}
