import { useMemo, useState } from "react";
import type {
  AppSettings,
  ExerciseItem,
  ExerciseType,
  GapFillInspectorControls,
  GapMode,
  InspectorFilters,
  InspectorPreset,
  Level,
} from "../types";
import type { MatchingDiagnostics, PackIssue } from "../lib/csv";
import { MAX_ITEMS_CHOICES } from "../lib/constants";
import {
  buildCsvExport,
  buildHtmlExport,
  itemLength,
  itemToPlainText,
  MAX_REGEX_PATTERN_LENGTH,
} from "../lib/inspector";

const TYPE_LABELS: Record<ExerciseType, string> = {
  gapfill: "Gap Fill",
  matching: "Matching",
  mcq: "Multiple Choice",
  scramble: "Scramble",
};

const PACK_FILENAMES: Record<ExerciseType, string> = {
  gapfill: "gapfill.csv",
  matching: "matching.csv",
  mcq: "mcq.csv",
  scramble: "scramble.csv",
};

const QUALITY_LABELS: Record<Exclude<InspectorFilters["bankQuality"], "all">, string> = {
  solid: "Solid bank",
  soft: "Soft bank",
  needs_review: "Needs review",
};

const GAP_MODE_LABELS: Record<GapMode, string> = {
  target: "Target lexis",
  collocation: "Collocation",
  grammar: "Grammar slot",
};

const GAP_MODE_OPTIONS: GapMode[] = ["target", "collocation", "grammar"];

const GAP_FILL_DIFFICULTY_OPTIONS = ["A1", "A2", "B1"] as const;

const GAP_FILL_BANK_MIN = 4;
const GAP_FILL_BANK_MAX = 8;

function parseLengthValue(value: string): number | null {
  if (value.trim() === "") {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

interface PackInspectorProps {
  allItems: ExerciseItem[];
  filteredItems: ExerciseItem[];
  visibleItems: ExerciseItem[];
  hiddenIds: Set<string>;
  filters: InspectorFilters;
  onFiltersChange: (filters: InspectorFilters) => void;
  onResetFilters: () => void;
  onToggleHidden: (itemId: string) => void;
  onClearHidden: () => void;
  isOpen: boolean;
  onToggleOpen: () => void;
  showDetails: boolean;
  onToggleDetails: () => void;
  showInfo: boolean;
  onToggleInfo: () => void;
  issues: PackIssue[];
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  level: Level;
  exerciseType: ExerciseType;
  rowCount: number;
  matchingDiagnostics?: MatchingDiagnostics | null;
  regexError?: string | null;
  gapFillControls: GapFillInspectorControls;
  onGapFillControlsChange: (next: GapFillInspectorControls) => void;
  presets: InspectorPreset[];
  onSavePreset: (name: string) => boolean;
  onApplyPreset: (id: string) => void;
  onDuplicatePreset: (id: string) => void;
  onDeletePreset: (id: string) => void;
}

function formatItemSummary(item: ExerciseItem): string {
  switch (item.type) {
    case "gapfill":
      return `${item.prompt} | Answer: ${item.answer}`;
    case "matching":
      return item.pairs.map((pair) => `${pair.left} ↔ ${pair.right}`).join(", ");
    case "mcq":
      return `${item.prompt} | Correct: ${item.answer}`;
    case "scramble":
      return `${item.prompt} | Answer: ${item.answer}`;
    default:
      return itemToPlainText(item);
  }
}

function downloadCsv(data: { csv: string; filename: string }) {
  if (typeof window === "undefined") {
    return;
  }
  const blob = new Blob([data.csv], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", data.filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

function downloadHtml(data: { html: string; filename: string }) {
  if (typeof window === "undefined") {
    return;
  }
  const blob = new Blob([data.html], { type: "text/html;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", data.filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

export function PackInspector({
  allItems,
  filteredItems,
  visibleItems,
  hiddenIds,
  filters,
  onFiltersChange,
  onResetFilters,
  onToggleHidden,
  onClearHidden,
  isOpen,
  onToggleOpen,
  showDetails,
  onToggleDetails,
  showInfo,
  onToggleInfo,
  issues,
  settings,
  onSettingsChange,
  level,
  exerciseType,
  rowCount,
  matchingDiagnostics,
  regexError,
  gapFillControls,
  onGapFillControlsChange,
  presets,
  onSavePreset,
  onApplyPreset,
  onDuplicatePreset,
  onDeletePreset,
}: PackInspectorProps) {

  const hiddenItems = useMemo(
    () => allItems.filter((item) => hiddenIds.has(item.id)),
    [allItems, hiddenIds],
  );

  const hasGapFillBanks = useMemo(
    () => allItems.some((item) => item.type === "gapfill" && item.bank && item.bank.length > 0),
    [allItems],
  );

  const bankQualityCounts = useMemo(() => {
    let solid = 0;
    let soft = 0;
    let needs = 0;
    allItems.forEach((item) => {
      if (item.type !== "gapfill" || !item.bankQuality) return;
      if (item.bankQuality === "soft") soft += 1;
      else if (item.bankQuality === "needs_review") needs += 1;
      else if (item.bankQuality === "solid") solid += 1;
    });
    return { solid, soft, needs };
  }, [allItems]);

  const datasetLabel = `${level} · ${TYPE_LABELS[exerciseType]}`;
  const sourcePath = `packs/${level}/${PACK_FILENAMES[exerciseType]}`;
  const severityLabel: Record<PackIssue["severity"], string> = {
    error: "Error",
    warning: "Warning",
    info: "Info",
  };

  const counts = useMemo(() => {
    let info = 0;
    let warning = 0;
    let error = 0;
    issues.forEach((issue) => {
      if (issue.severity === "info") {
        info += 1;
      } else if (issue.severity === "warning") {
        warning += 1;
      } else if (issue.severity === "error") {
        error += 1;
      }
    });
    return { infoCount: info, warningCount: warning, errorCount: error };
  }, [issues]);

  const diagnosticsSummary = useMemo(() => {
    if (issues.length === 0) {
      return "";
    }
    const parts: string[] = [];
    if (counts.errorCount > 0) {
      parts.push(`${counts.errorCount} error${counts.errorCount === 1 ? "" : "s"}`);
    }
    if (counts.warningCount > 0) {
      parts.push(`${counts.warningCount} warning${counts.warningCount === 1 ? "" : "s"}`);
    }
    if (counts.infoCount > 0) {
      parts.push(`${counts.infoCount} info note${counts.infoCount === 1 ? "" : "s"}`);
    }
    return parts.join(", ");
  }, [counts.errorCount, counts.warningCount, counts.infoCount, issues.length]);

  const sortedIssues = useMemo(() => {
    const order: Record<PackIssue["severity"], number> = {
      error: 0,
      warning: 1,
      info: 2,
    };
    return issues
      .filter((issue) => (issue.severity === "info" ? showInfo : true))
      .sort((a, b) => order[a.severity] - order[b.severity]);
  }, [issues, showInfo]);

  const handleFilterChange = <Key extends keyof InspectorFilters>(
    key: Key,
    value: InspectorFilters[Key],
  ) => {
    onFiltersChange({
      ...filters,
      [key]: value,
    });
  };

  const handleGapFillControlChange = <Key extends keyof GapFillInspectorControls>(
    key: Key,
    value: GapFillInspectorControls[Key],
  ) => {
    onGapFillControlsChange({
      ...gapFillControls,
      [key]: value,
    });
  };

  const handleHintToggle = (hint: keyof GapFillInspectorControls["hints"]) => {
    onGapFillControlsChange({
      ...gapFillControls,
      hints: {
        ...gapFillControls.hints,
        [hint]: !gapFillControls.hints[hint],
      },
    });
  };

  const handleExport = () => {
    const exportData = buildCsvExport(visibleItems, exerciseType, level);
    if (!exportData) {
      return;
    }
    downloadCsv(exportData);
  };

  const handleHtmlExport = () => {
    const exportData = buildHtmlExport(
      visibleItems,
      exerciseType,
      level,
      exerciseType === "gapfill" ? { gapFill: gapFillControls } : undefined,
    );
    if (!exportData) {
      return;
    }
    downloadHtml(exportData);
  };

  const filteredCount = filteredItems.length;
  const hiddenCount = hiddenIds.size;
  const visibleCount = visibleItems.length;
  const filteredOutCount = Math.max(0, allItems.length - filteredCount);
  const matchingSummary = matchingDiagnostics
    ? `Rows ${matchingDiagnostics.rowsParsed} • Pairs ${matchingDiagnostics.pairsParsed} • Duplicates dropped ${matchingDiagnostics.duplicatePairsDropped} • Legacy rows ${matchingDiagnostics.legacyRows} • Shape ${matchingDiagnostics.shape}`
    : null;
  const invalidRange =
    filters.minLength !== null &&
    filters.maxLength !== null &&
    filters.minLength > filters.maxLength;

  const [presetName, setPresetName] = useState("");
  const [presetError, setPresetError] = useState<string | null>(null);

  const handleSavePresetClick = () => {
    const success = onSavePreset(presetName);
    if (success) {
      setPresetName("");
      setPresetError(null);
    } else {
      setPresetError("Enter a preset name before saving.");
    }
  };

  return (
    <section className="pack-inspector" aria-label="Pack inspector">
      <header className="pack-inspector__header">
        <div>
          <h2 id="pack-inspector-heading">Pack Inspector</h2>
          <p className="pack-inspector__meta" aria-live="polite">
            Dataset: {datasetLabel} → <code>{sourcePath}</code>
          </p>
          {diagnosticsSummary && (
            <p className="pack-inspector__meta" aria-live="polite">
              Diagnostics: {diagnosticsSummary}
            </p>
          )}
          <p className="pack-inspector__meta" aria-live="polite">
            Parsed {rowCount} row{rowCount === 1 ? "" : "s"} • Valid {allItems.length} item{allItems.length === 1 ? "" : "s"} • Filtered out {filteredOutCount}
            • Hidden {hiddenCount} • Displaying {visibleCount}
          </p>
          {exerciseType === "gapfill" && (bankQualityCounts.soft > 0 || bankQualityCounts.needs > 0) && (
            <p className="pack-inspector__meta pack-inspector__meta--warning" aria-live="polite">
              Gap-fill banks: {bankQualityCounts.solid} solid • {bankQualityCounts.soft} soft • {bankQualityCounts.needs} needs review
            </p>
          )}
          {exerciseType === "matching" && matchingSummary && (
            <p className="pack-inspector__meta" aria-live="polite">
              Matching summary: {matchingSummary}
            </p>
          )}
        </div>
        <div className="pack-inspector__header-actions">
          <button
            type="button"
            className="pack-inspector__toggle"
            onClick={onToggleOpen}
            aria-expanded={isOpen}
            aria-controls="pack-inspector-panel"
          >
            {isOpen ? "Hide" : "Show"} inspector
          </button>
        </div>
      </header>
      {isOpen && (
        <div id="pack-inspector-panel" className="pack-inspector__panel" aria-labelledby="pack-inspector-heading">
          {issues.length > 0 && (
            <section className="pack-inspector__diagnostics" aria-label="Pack diagnostics">
              <div className="pack-inspector__diagnostics-header">
                <h3>Diagnostics</h3>
                <div className="pack-inspector__diagnostics-toggle-group">
                  <label className="pack-inspector__diagnostics-toggle">
                    <input type="checkbox" checked={showInfo} onChange={() => onToggleInfo()} />
                    <span>Show info notices</span>
                  </label>
                  <label className="pack-inspector__diagnostics-toggle">
                    <input
                      type="checkbox"
                      checked={showDetails}
                      onChange={() => onToggleDetails()}
                    />
                    <span>Show detailed warnings</span>
                  </label>
                </div>
              </div>
              <ul>
                {sortedIssues.map((issue, index) => (
                  <li
                    key={`diagnostic-${index}`}
                    className={`pack-inspector__diagnostics-item pack-inspector__diagnostics-item--${issue.severity}`}
                  >
                    <div className="pack-inspector__diagnostics-summary">
                      <span className="pack-inspector__diagnostic-tag">
                        {severityLabel[issue.severity]}
                      </span>
                      <span>
                        {issue.message}
                        {issue.hint ? ` — ${issue.hint}` : ""}
                      </span>
                    </div>
                    {showDetails && issue.details && issue.details.length > 0 && (
                      <ul className="pack-inspector__diagnostics-details">
                        {issue.details.map((detail, detailIndex) => (
                          <li key={`diagnostic-${index}-detail-${detailIndex}`}>{detail}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <div className="pack-inspector__controls">
            <fieldset>
              <legend>Filters</legend>
              <div className="pack-inspector__control-group">
                <label>
                  <span>Contains word</span>
                  <input
                    type="text"
                    value={filters.contains}
                    onChange={(event) => handleFilterChange("contains", event.target.value)}
                  />
                </label>
                <label>
                  <span>Min length</span>
                  <input
                    type="number"
                    min={0}
                    value={filters.minLength ?? ""}
                    onChange={(event) => {
                      handleFilterChange(
                        "minLength",
                        parseLengthValue(event.target.value),
                      );
                    }}
                  />
                </label>
                <label>
                  <span>Max length</span>
                  <input
                    type="number"
                    min={0}
                    value={filters.maxLength ?? ""}
                    onChange={(event) => {
                      handleFilterChange(
                        "maxLength",
                        parseLengthValue(event.target.value),
                      );
                    }}
                  />
                </label>
                <label>
                  <span className="pack-inspector__label-text">
                    Regex (optional)
                    <span
                      className="pack-inspector__help-icon"
                      title="Optional JavaScript regular expression. Examples: ^start (anchored), end$ (suffix), (cat|dog) (alternation), \\d{2,} (numbers). Leave blank to disable."
                      aria-label="Regex help: uses JavaScript syntax. Examples include ^start, end$, (cat|dog), \\d{2,}."
                    >
                      ?
                    </span>
                  </span>
                  <input
                    type="text"
                    value={filters.regex}
                    maxLength={MAX_REGEX_PATTERN_LENGTH}
                    aria-invalid={Boolean(regexError)}
                    onChange={(event) => {
                      handleFilterChange("regex", event.target.value);
                    }}
                  />
                </label>
                <label>
                  <span>Bank quality</span>
                  <select
                    value={filters.bankQuality}
                    onChange={(event) =>
                      handleFilterChange(
                        "bankQuality",
                        event.target.value as InspectorFilters["bankQuality"],
                      )
                    }
                  >
                    <option value="all">All</option>
                    <option value="solid">Solid</option>
                    <option value="soft">Soft</option>
                    <option value="needs_review">Needs review</option>
                  </select>
                </label>
                <label className="pack-inspector__checkbox">
                  <input
                    type="checkbox"
                    checked={filters.relaxedOnly}
                    onChange={(event) =>
                      handleFilterChange("relaxedOnly", event.target.checked)
                    }
                  />
                  <span>Only banks with relaxed distractors</span>
                </label>
              </div>
              {invalidRange && (
                <p className="pack-inspector__hint" role="alert">
                  Min length is greater than max length. Adjust the range to see results.
                </p>
              )}
              {filters.regex.trim() !== "" && regexError && (
                <p className="pack-inspector__hint" role="alert">
                  Regex issue: {regexError}
                </p>
              )}
              <div className="pack-inspector__control-actions">
                <button type="button" onClick={onResetFilters}>
                  Reset filters
                </button>
              </div>
            </fieldset>
            <fieldset>
              <legend>Session controls</legend>
              <div className="pack-inspector__control-group">
                <label>
                  <span>Shuffle</span>
                  <input
                    type="checkbox"
                    checked={settings.shuffle}
                    onChange={(event) =>
                      onSettingsChange({
                        ...settings,
                        shuffle: event.target.checked,
                      })
                    }
                  />
                </label>
                <label>
                  <span>Max items</span>
                  <select
                    value={settings.maxItems === "all" ? "all" : settings.maxItems.toString()}
                    onChange={(event) => {
                      const raw = event.target.value;
                      onSettingsChange({
                        ...settings,
                        maxItems: raw === "all" ? "all" : Number.parseInt(raw, 10),
                      });
                    }}
                  >
                    {MAX_ITEMS_CHOICES.map((option) => {
                      const value = option === "all" ? "all" : option.toString();
                      const label = option === "all" ? "All" : option.toString();
                      return (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                </label>
              </div>
              <div className="pack-inspector__control-actions">
                <button type="button" onClick={handleExport} disabled={visibleItems.length === 0}>
                  Export CSV
                </button>
                <button type="button" onClick={handleHtmlExport} disabled={visibleItems.length === 0}>
                  Export HTML
                </button>
              </div>
            </fieldset>
            {exerciseType === "gapfill" && (
              <fieldset>
                <legend>Gap-fill controls</legend>
                <div className="pack-inspector__control-group">
                  <label>
                    <span>Gap mode</span>
                    <select
                      value={gapFillControls.mode}
                      onChange={(event) =>
                        handleGapFillControlChange("mode", event.target.value as GapMode)
                      }
                    >
                      {GAP_MODE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {GAP_MODE_LABELS[option]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Bank size</span>
                    <input
                      type="number"
                      min={GAP_FILL_BANK_MIN}
                      max={GAP_FILL_BANK_MAX}
                      step={1}
                      value={gapFillControls.bankSize}
                      onChange={(event) => {
                        const parsed = Number.parseInt(event.target.value, 10);
                        const clamped = Number.isNaN(parsed)
                          ? GAP_FILL_BANK_MIN
                          : Math.min(Math.max(parsed, GAP_FILL_BANK_MIN), GAP_FILL_BANK_MAX);
                        handleGapFillControlChange("bankSize", clamped);
                      }}
                      disabled={!hasGapFillBanks}
                    />
                  </label>
                  {!hasGapFillBanks && (
                    <p className="pack-inspector__hint" role="note">
                      Word banks unavailable for this pack.
                    </p>
                  )}
                  <label>
                    <span>Difficulty</span>
                    <select
                      value={gapFillControls.difficulty}
                      onChange={(event) =>
                        handleGapFillControlChange(
                          "difficulty",
                          event.target.value as GapFillInspectorControls["difficulty"],
                        )
                      }
                    >
                      {GAP_FILL_DIFFICULTY_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Max blanks / sentence</span>
                    <select
                      value={gapFillControls.maxBlanksPerSentence}
                      onChange={(event) =>
                        handleGapFillControlChange(
                          "maxBlanksPerSentence",
                          event.target.value === "2" ? 2 : 1,
                        )
                      }
                    >
                      <option value={1}>1</option>
                      <option value={2}>2</option>
                    </select>
                  </label>
                </div>
                <div className="pack-inspector__control-group pack-inspector__control-group--column">
                  <span>Hints</span>
                  <label className="pack-inspector__checkbox">
                    <input
                      type="checkbox"
                      checked={gapFillControls.hints.initialLetter}
                      onChange={() => handleHintToggle("initialLetter")}
                    />
                    <span>Initial letter</span>
                  </label>
                  <label className="pack-inspector__checkbox">
                    <input
                      type="checkbox"
                      checked={gapFillControls.hints.pos}
                      onChange={() => handleHintToggle("pos")}
                    />
                    <span>Part of speech</span>
                  </label>
                  <label className="pack-inspector__checkbox">
                    <input
                      type="checkbox"
                      checked={gapFillControls.hints.collocationCue}
                      onChange={() => handleHintToggle("collocationCue")}
                    />
                    <span>Collocation cue</span>
                  </label>
                  <label className="pack-inspector__checkbox">
                    <input
                      type="checkbox"
                      checked={gapFillControls.hints.tts}
                      onChange={() => handleHintToggle("tts")}
                    />
                    <span>TTS hint</span>
                  </label>
                </div>
              </fieldset>
            )}
            <fieldset>
              <legend>Presets</legend>
              <div className="pack-inspector__control-group pack-inspector__control-group--column">
                <label>
                  <span>Preset name</span>
                  <input
                    type="text"
                    value={presetName}
                    onChange={(event) => setPresetName(event.target.value)}
                    placeholder="e.g. Collocations A2"
                  />
                </label>
                {presetError && (
                  <p className="pack-inspector__hint" role="alert">
                    {presetError}
                  </p>
                )}
                <div className="pack-inspector__control-actions">
                  <button type="button" onClick={handleSavePresetClick}>
                    Save preset
                  </button>
                </div>
              </div>
              {presets.length > 0 ? (
                <ul className="pack-inspector__presets">
                  {presets.map((preset) => (
                    <li key={preset.id} className="pack-inspector__preset-item">
                      <div className="pack-inspector__preset-meta">
                        <strong>{preset.name}</strong>
                        <span>{new Date(preset.createdAt).toLocaleString()}</span>
                      </div>
                      <div className="pack-inspector__preset-actions">
                        <button type="button" onClick={() => onApplyPreset(preset.id)}>
                          Apply
                        </button>
                        <button type="button" onClick={() => onDuplicatePreset(preset.id)}>
                          Duplicate w/ new seed
                        </button>
                        <button type="button" onClick={() => onDeletePreset(preset.id)}>
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="pack-inspector__empty">No presets saved yet.</p>
              )}
            </fieldset>
          </div>
          <div className="pack-inspector__lists">
            <section aria-label="Visible items">
              <header className="pack-inspector__list-header">
                <h3>Visible items</h3>
                <span>{visibleCount} items</span>
              </header>
              {visibleItems.length === 0 ? (
                <p className="pack-inspector__empty">No items match the current filters.</p>
              ) : (
                <ul className="pack-inspector__list">
                  {visibleItems.map((item) => {
                    const qualityClass =
                      item.type === "gapfill" && item.bankQuality && item.bankQuality !== "solid"
                        ? ` pack-inspector__item--${item.bankQuality}`
                        : "";
                    return (
                      <li key={item.id} className={`pack-inspector__item${qualityClass}`}>
                      <div className="pack-inspector__item-body">
                        <div className="pack-inspector__item-summary">{formatItemSummary(item)}</div>
                        <div className="pack-inspector__item-meta">
                          <span>Length: {itemLength(item)}</span>
                          {item.source && <span>Source: {item.source}</span>}
                          {item.type === "gapfill" && item.bankMeta?.slot && (
                            <span className="pack-inspector__slot">Slot: {item.bankMeta.slot}</span>
                          )}
                          {item.type === "gapfill" && item.bankQuality && item.bankQuality !== "solid" && (
                            <span
                              className={`pack-inspector__badge pack-inspector__badge--${item.bankQuality}`}
                              title={QUALITY_LABELS[item.bankQuality as keyof typeof QUALITY_LABELS]}
                            >
                              {QUALITY_LABELS[item.bankQuality as keyof typeof QUALITY_LABELS]}
                            </span>
                          )}
                          {item.type === "gapfill" && item.bankMeta?.tags && item.bankMeta.tags.length > 0 && (
                            <span className="pack-inspector__tags">
                              {item.bankMeta.tags.map((tag) => (
                                <span key={`${item.id}-tag-${tag}`} className={`pack-inspector__tag pack-inspector__tag--${tag}`}>
                                  {tag}
                                </span>
                              ))}
                            </span>
                          )}
                        </div>
                      </div>
                      <button type="button" onClick={() => onToggleHidden(item.id)}>
                        Hide
                      </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
            <section aria-label="Hidden items">
              <header className="pack-inspector__list-header">
                <h3>Hidden items</h3>
                <span>{hiddenCount} hidden</span>
              </header>
              {hiddenItems.length === 0 ? (
                <p className="pack-inspector__empty">No items hidden.</p>
              ) : (
                <>
                  <div className="pack-inspector__control-actions">
                    <button type="button" onClick={onClearHidden}>
                      Clear hidden
                    </button>
                  </div>
                  <ul className="pack-inspector__list pack-inspector__list--compact">
                    {hiddenItems.map((item) => (
                      <li key={item.id} className="pack-inspector__item pack-inspector__item--muted">
                        <div className="pack-inspector__item-body">
                          <div className="pack-inspector__item-summary">{formatItemSummary(item)}</div>
                        </div>
                        <button type="button" onClick={() => onToggleHidden(item.id)}>
                          Unhide
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>
        </div>
      )}
    </section>
  );
}
