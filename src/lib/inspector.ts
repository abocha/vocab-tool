import type {
  ExerciseItem,
  ExerciseType,
  GapFillHints,
  GapFillInspectorControls,
  GapFillItem,
  InspectorFilters,
  Level,
  MatchingItem,
  MatchingPair,
  McqItem,
  ScrambleItem,
} from "../types";

export const MAX_REGEX_PATTERN_LENGTH = 256;

export function compileInspectorRegex(pattern: string): { regex: RegExp | null; error: string | null } {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return { regex: null, error: null };
  }

  if (trimmed.length > MAX_REGEX_PATTERN_LENGTH) {
    return {
      regex: null,
      error: `Pattern exceeds ${MAX_REGEX_PATTERN_LENGTH} characters`,
    };
  }

  try {
    return {
      regex: new RegExp(trimmed, "iu"),
      error: null,
    };
  } catch (error) {
    return {
      regex: null,
      error: error instanceof Error ? error.message : "Invalid regular expression",
    };
  }
}

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatForHtml(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, "<br />");
}

function renderGapFillPrompt(prompt: string): string {
  const placeholder = "__HTML_BLANK__";
  const markedPrompt = prompt.replace(/_{2,}/g, placeholder);
  const escaped = formatForHtml(markedPrompt);
  return escaped.replace(new RegExp(placeholder, "g"), '<span class="blank"></span>');
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
  options?: { regex?: RegExp | null; gapFill?: GapFillInspectorControls },
): ExerciseItem[] {
  const contains = filters.contains.trim().toLowerCase();
  const min = filters.minLength ?? null;
  const max = filters.maxLength ?? null;
  const regex = options?.regex ?? null;

  return items.filter((item) => {
    if (hiddenIds.has(item.id)) {
      return false;
    }
    if ((filters.bankQuality !== "all" || filters.relaxedOnly) && item.type !== "gapfill") {
      return false;
    }
    const plain = cleanWhitespace(itemToPlainText(item));
    const plainLower = plain.toLowerCase();
    const length = plain.length;

    if (contains && !plainLower.includes(contains)) {
      return false;
    }
    if (min !== null && length < min) {
      return false;
    }
    if (max !== null && length > max) {
      return false;
    }

    if (regex && !regex.test(plain)) {
      return false;
    }

    if (item.type === "gapfill") {
      if (filters.bankQuality !== "all") {
        const quality = item.bankQuality ?? "solid";
        if (quality !== filters.bankQuality) {
          return false;
        }
      }
      if (filters.relaxedOnly) {
        const hasRelaxed = item.bankMeta?.tags?.includes("relaxed");
        if (!hasRelaxed) {
          return false;
        }
      }
      if (options?.gapFill) {
        const controls = options.gapFill;
        if (controls.mode && item.gapMode && controls.mode !== item.gapMode) {
          return false;
        }
        const blankCount = (item.prompt.match(/_____/g) ?? []).length || 0;
        if (blankCount > controls.maxBlanksPerSentence) {
          return false;
        }
      }
    }
    return true;
  });
}

function buildGapFillCsv(items: GapFillItem[], level: Level): string {
  const header = "level,type,prompt,answers,answer,source,license,gap_mode,bank,hints,bank_quality,bank_meta";
  const serializeHints = (hints: GapFillHints | undefined): string => {
    if (!hints) {
      return "";
    }
    return Object.entries(hints)
      .map(([key, value]) => {
        if (!key) {
          return value ?? "";
        }
        return value ? `${key}=${value}` : key;
      })
      .join(";");
  };
  const rows = items.map((item) => {
    const cells = [
      item.level ?? level,
      item.type,
      item.prompt,
      (item.answers ?? [item.answer]).join("|"),
      item.answer,
      item.source ?? "",
      item.license ?? "",
      item.gapMode ?? "",
      item.bank ? item.bank.join("|") : "",
      serializeHints(item.hints),
      item.bankQuality ?? "",
      item.bankMeta ? JSON.stringify(item.bankMeta) : "",
    ];
    return cells.map(csvEscape).join(",");
  });
  return [header, ...rows].join("\n");
}

function buildMatchingCsv(items: MatchingItem[], level: Level): string {
  const header = "level,type,left,right,source,license,count";
  const rows: string[] = [];
  items.forEach((item) => {
    const total = item.pairs.length;
    item.pairs.forEach((pair) => {
      const cells = [
        (pair.level as Level) ?? item.level ?? level,
        item.type,
        pair.left,
        pair.right,
        pair.source ?? item.source ?? "",
        pair.license ?? item.license ?? "",
        total > 0 ? String(total) : "",
      ];
      rows.push(cells.map(csvEscape).join(","));
    });
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

function formatExportTimestamp(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}${month}${day}-${hours}${minutes}`;
}

function buildGapFillHtml(
  items: GapFillItem[],
  controls?: GapFillInspectorControls,
): { exercises: string; answers: string } {
  const exercises = items
    .map((item) => {
      const promptHtml = renderGapFillPrompt(item.prompt);
      const answers = item.answers ?? [item.answer];
      const bank = controls ? (item.bank ?? []).slice(0, controls.bankSize) : item.bank ?? [];
      const hintsData = item.hints ?? {};
      const textualHints: string[] = [];

      if (controls?.hints.initialLetter) {
        const first = hintsData.first ?? answers[0]?.charAt(0);
        if (first) {
          textualHints.push(`Starts with “${escapeHtml(first)}”`);
        }
      }

      if (controls?.hints.pos) {
        const posHint = hintsData.pos ?? hintsData.partOfSpeech;
        if (posHint) {
          textualHints.push(`Part of speech: ${escapeHtml(posHint)}`);
        }
      }

      if (controls?.hints.collocationCue) {
        const cueHint = hintsData.cue ?? hintsData.collocation ?? hintsData.partner;
        if (cueHint) {
          textualHints.push(`Collocation cue: ${escapeHtml(cueHint)}`);
        }
      }

      const ttsSource = controls?.hints.tts ? hintsData.tts ?? hintsData.audio ?? "" : "";

      const bankHtml = bank.length
        ? `<div class="gapfill-bank"><h4>Word bank</h4><ul>${bank
            .map((entry) => `<li>${escapeHtml(entry)}</li>`)
            .join("")}</ul></div>`
        : "";

      let hintsHtml = "";
      if (textualHints.length > 0 || ttsSource) {
        const textList = textualHints.length
          ? `<ul>${textualHints.map((hint) => `<li>${hint}</li>`).join("")}</ul>`
          : "";
        const audio = ttsSource
          ? `<div class="gapfill-hint__audio"><audio controls preload="none" src="${escapeHtml(ttsSource)}"></audio></div>`
          : "";
        hintsHtml = `<div class="gapfill-hints"><h4>Hints</h4>${textList}${audio}</div>`;
      }

      return `<li class="exercise-item"><div class="prompt">${promptHtml}</div>${bankHtml}${hintsHtml}</li>`;
    })
    .join("");

  const answers = items
    .map((item) => `<li><span class="answer">${formatForHtml(item.answer)}</span></li>`)
    .join("");

  return { exercises, answers };
}

function buildMatchingHtml(items: MatchingItem[]): { exercises: string; answers: string } {
  const exercises = items
    .map((item) => {
      const rows = item.pairs
        .map((pair, index) => {
          return `<tr>
            <td class="index">${index + 1}.</td>
            <td class="left">${formatForHtml(pair.left)}</td>
            <td class="answer-blank"></td>
          </tr>`;
        })
        .join("");

      const wordBank = item.pairs
        .map((pair, index) => {
          const letter = String.fromCharCode(65 + index);
          return `<li><span class="option-letter">${letter}.</span> ${formatForHtml(pair.right)}</li>`;
        })
        .join("");

      return `<li class="exercise-item matching">
        <table class="matching-table">
          <colgroup>
            <col class="col-index" />
            <col class="col-left" />
            <col class="col-blank" />
          </colgroup>
          ${rows}
        </table>
        <div class="word-bank">
          <h4>Word Bank</h4>
          <ol class="word-bank__list">
            ${wordBank}
          </ol>
        </div>
      </li>`;
    })
    .join("");

  const answers = items
    .map((item) => {
      const rows = item.pairs
        .map((pair, index) => {
          const letter = String.fromCharCode(65 + index);
          return `<tr>
            <td class="index">${index + 1}.</td>
            <td class="left">${formatForHtml(pair.left)}</td>
            <td class="right"><span class="option-letter">${letter}.</span> ${formatForHtml(pair.right)}</td>
          </tr>`;
        })
        .join("");

      return `<li><table class="matching-table matching-table--answers">
        <colgroup>
          <col class="col-index" />
          <col class="col-left" />
          <col class="col-right" />
        </colgroup>
        ${rows}
      </table></li>`;
    })
    .join("");

  return { exercises, answers };
}

function buildMcqHtml(items: McqItem[]): { exercises: string; answers: string } {
  const exercises = items
    .map((item) => {
      const options = item.options
        .map(
          (option, index) =>
            `<li><span class="option-letter">${String.fromCharCode(65 + index)}.</span><span>${formatForHtml(
              option,
            )}</span></li>`,
        )
        .join("");
      return `<li class="exercise-item"><div class="prompt">${formatForHtml(
        item.prompt,
      )}</div><ol class="option-list">${options}</ol></li>`;
    })
    .join("");

  const answers = items
    .map((item) => `<li><span class="answer">${formatForHtml(item.answer)}</span></li>`)
    .join("");

  return { exercises, answers };
}

function buildScrambleHtml(items: ScrambleItem[]): { exercises: string; answers: string } {
  const exercises = items
    .map((item) => `<li class="exercise-item"><div class="prompt">${formatForHtml(item.prompt)}</div></li>`)
    .join("");

  const answers = items
    .map((item) => `<li><span class="answer">${formatForHtml(item.answer)}</span></li>`)
    .join("");

  return { exercises, answers };
}

function buildHtmlStyles(): string {
  return `
    <style>
      :root {
        color-scheme: light;
        font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      }

      body {
        margin: 0;
        padding: 0.75in 0.65in;
        background: #fff;
        color: #111;
        line-height: 1.5;
        max-width: 8in;
      }

      @page {
        margin: 0.5in;
      }

      @media screen {
        body {
          margin: 0 auto;
          padding: 1in;
        }
      }

      h1 {
        text-align: center;
        margin-bottom: 0.4em;
      }

      h2 {
        margin: 1.25em 0 0.6em;
      }

      h4 {
        margin: 0.6em 0 0.3em;
      }

      .meta {
        margin-bottom: 1.2em;
        font-size: 0.95em;
      }

      .meta span {
        display: inline-block;
        margin-right: 1.25em;
      }

      ol.exercise-list,
      ol.answer-list {
        list-style: decimal;
        padding-left: 1.25em;
      }

      .exercise-item {
        margin-bottom: 0.6em;
        break-inside: avoid;
      }

      .prompt {
        font-weight: 600;
      }

      .blank {
        display: inline-block;
        min-width: 6ch;
        border-bottom: 2px solid #333;
        margin: 0 0.15em;
      }

      .gapfill-bank {
        margin: 0.65em 0;
        padding: 0.5em 0.75em;
        background: #f5f5f5;
        border-radius: 6px;
      }

      .gapfill-bank h4 {
        margin: 0 0 0.35em;
        font-size: 0.95em;
        text-transform: uppercase;
        letter-spacing: 0.02em;
      }

      .gapfill-bank ul {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4em 0.6em;
        list-style: none;
        padding: 0;
        margin: 0;
      }

      .gapfill-bank li {
        padding: 0.2em 0.55em;
        border: 1px solid #d2d2d2;
        border-radius: 4px;
        background: #fff;
      }

      .gapfill-hints {
        margin: 0.65em 0;
        padding: 0.55em 0.8em;
        background: #eef6ff;
        border-left: 3px solid #2f6fde;
        border-radius: 4px;
      }

      .gapfill-hints h4 {
        margin: 0 0 0.3em;
        font-size: 0.95em;
      }

      .gapfill-hints ul {
        margin: 0;
        padding-left: 1.1em;
      }

      .gapfill-hint__audio {
        margin-top: 0.4em;
      }

      .matching-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        margin-bottom: 0.4em;
      }

      .matching-table td {
        border-bottom: 1px solid #d4d4d4;
        padding: 0.3em 0.45em;
        vertical-align: top;
      }

      .matching-table .index {
        width: 2em;
        font-weight: 600;
        text-align: right;
      }

      .matching-table .left {
        width: 60%;
      }

      .matching-table .answer-blank {
        width: 30%;
        border-bottom: 2px solid #333;
      }

      .matching-table--answers .right {
        font-weight: 600;
      }

      .word-bank {
        margin-left: 2.4em;
      }

      .word-bank__list {
        list-style: none;
        margin: 0;
        padding: 0;
        columns: 2;
        column-gap: 1.5em;
      }

      .word-bank__list li {
        break-inside: avoid;
        margin-bottom: 0.2em;
      }

      .option-letter {
        font-weight: 600;
        margin-right: 0.4em;
      }

      .answer-key {
        page-break-before: always;
      }

      .answer-list .answer {
        font-weight: 600;
      }

      @media print {
        body {
          font-size: 11pt;
          max-width: none;
          padding: 0;
        }
      }
    </style>
  `;
}

const EXERCISE_TYPE_LABELS: Record<ExerciseType, string> = {
  gapfill: "Gap Fill",
  matching: "Matching",
  mcq: "Multiple Choice",
  scramble: "Scramble",
};

export function buildHtmlExport(
  items: ExerciseItem[],
  type: ExerciseType,
  level: Level,
  options?: {
    gapFill?: GapFillInspectorControls;
  },
): { html: string; filename: string } | null {
  if (items.length === 0) {
    return null;
  }

  const timestamp = formatExportTimestamp(new Date());
  const filename = `${type}.curated.${level}.${timestamp}.html`;
  const label = EXERCISE_TYPE_LABELS[type];

  let sections: { exercises: string; answers: string };
  switch (type) {
    case "gapfill":
      sections = buildGapFillHtml(items as GapFillItem[], options?.gapFill);
      break;
    case "matching":
      sections = buildMatchingHtml(items as MatchingItem[]);
      break;
    case "mcq":
      sections = buildMcqHtml(items as McqItem[]);
      break;
    case "scramble":
      sections = buildScrambleHtml(items as ScrambleItem[]);
      break;
    default:
      return null;
  }

  const generatedOn = new Date().toISOString();

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(label)} · Level ${escapeHtml(level)} · Vocab Tool</title>
    ${buildHtmlStyles()}
  </head>
  <body>
    <h1>${escapeHtml(label)} Exercises</h1>
    <section class="meta">
      <span><strong>Level:</strong> ${escapeHtml(level)}</span>
      <span><strong>Total items:</strong> ${items.length}</span>
      <span><strong>Generated:</strong> ${escapeHtml(generatedOn)}</span>
    </section>
    <section>
      <h2>Exercises</h2>
      <ol class="exercise-list">
        ${sections.exercises}
      </ol>
    </section>
    <section class="answer-key">
      <h2>Answer Key</h2>
      <ol class="answer-list">
        ${sections.answers}
      </ol>
    </section>
  </body>
</html>`;

  return { html, filename };
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

  const timestamp = formatExportTimestamp(new Date());
  const filename = `${type}.curated.${level}.${timestamp}.csv`;
  const BOM = "\ufeff";
  return { csv: `${BOM}${csv}\n`, filename };
}
