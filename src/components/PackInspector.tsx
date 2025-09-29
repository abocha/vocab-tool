import { useMemo } from "react";
import type {
  AppSettings,
  ExerciseItem,
  ExerciseType,
  InspectorFilters,
  Level,
} from "../types";
import type { PackIssue } from "../lib/csv";
import { MAX_ITEMS_CHOICES } from "../lib/constants";
import { buildCsvExport, itemLength, itemToPlainText } from "../lib/inspector";

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
  issues: PackIssue[];
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  level: Level;
  exerciseType: ExerciseType;
  rowCount: number;
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
  issues,
  settings,
  onSettingsChange,
  level,
  exerciseType,
  rowCount,
}: PackInspectorProps) {

  const hiddenItems = useMemo(
    () => allItems.filter((item) => hiddenIds.has(item.id)),
    [allItems, hiddenIds],
  );

  const datasetLabel = `${level} · ${TYPE_LABELS[exerciseType]}`;
  const sourcePath = `packs/${level}/${PACK_FILENAMES[exerciseType]}`;
  const warningIssues = useMemo(
    () => issues.filter((issue) => issue.severity === "warning"),
    [issues],
  );
  const errorIssues = useMemo(
    () => issues.filter((issue) => issue.severity === "error"),
    [issues],
  );
  const errorCount = errorIssues.length;
  const warningCount = warningIssues.length;
  const diagnosticsSummary = useMemo(() => {
    if (issues.length === 0) {
      return "";
    }
    const parts: string[] = [];
    if (errorCount > 0) {
      parts.push(`${errorCount} error${errorCount === 1 ? "" : "s"}`);
    }
    if (warningCount > 0) {
      parts.push(`${warningCount} warning${warningCount === 1 ? "" : "s"}`);
    }
    return parts.join(", ");
  }, [errorCount, warningCount, issues.length]);

  const handleFilterChange = <Key extends keyof InspectorFilters>(
    key: Key,
    value: InspectorFilters[Key],
  ) => {
    onFiltersChange({
      ...filters,
      [key]: value,
    });
  };

  const handleExport = () => {
    const exportData = buildCsvExport(visibleItems, exerciseType, level);
    if (!exportData) {
      return;
    }
    downloadCsv(exportData);
  };

  const filteredCount = filteredItems.length;
  const hiddenCount = hiddenIds.size;
  const visibleCount = visibleItems.length;
  const invalidRange =
    filters.minLength !== null &&
    filters.maxLength !== null &&
    filters.minLength > filters.maxLength;

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
            Parsed {rowCount} rows → {allItems.length} valid items. After filters: {filteredCount}. Displayed:
            {` ${visibleCount}`}.
          </p>
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
              <h3>Diagnostics</h3>
              <ul>
                {errorIssues.map((issue) => (
                  <li key={`diagnostic-error-${issue.message}`} className="pack-inspector__diagnostics-item pack-inspector__diagnostics-item--error">
                    <span className="pack-inspector__diagnostic-tag">Error</span>
                    <span>
                      {issue.message}
                      {issue.hint ? ` — ${issue.hint}` : ""}
                    </span>
                  </li>
                ))}
                {warningIssues.map((issue) => (
                  <li key={`diagnostic-warning-${issue.message}`} className="pack-inspector__diagnostics-item pack-inspector__diagnostics-item--warning">
                    <span className="pack-inspector__diagnostic-tag">Warning</span>
                    <span>
                      {issue.message}
                      {issue.hint ? ` — ${issue.hint}` : ""}
                    </span>
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
              </div>
              {invalidRange && (
                <p className="pack-inspector__hint" role="alert">
                  Min length is greater than max length. Adjust the range to see results.
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
              </div>
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
                  {visibleItems.map((item) => (
                    <li key={item.id} className="pack-inspector__item">
                      <div className="pack-inspector__item-body">
                        <div className="pack-inspector__item-summary">{formatItemSummary(item)}</div>
                        <div className="pack-inspector__item-meta">
                          <span>Length: {itemLength(item)}</span>
                          {item.source && <span>Source: {item.source}</span>}
                        </div>
                      </div>
                      <button type="button" onClick={() => onToggleHidden(item.id)}>
                        Hide
                      </button>
                    </li>
                  ))}
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
