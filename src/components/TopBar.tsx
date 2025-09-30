import { useMemo } from "react";
import type { AppSettings } from "../types";
import { MAX_ITEMS_CHOICES } from "../lib/constants";

interface TopBarProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  stats: {
    correct: number;
    total: number;
  };
  onResetProgress: () => void;
  matchingSetSize: number;
  onMatchingSetSizeChange: (value: number) => void;
  matchingSeed?: string | null;
}

const typeLabels: Record<AppSettings["exerciseType"], string> = {
  gapfill: "Gap Fill",
  matching: "Matching",
  mcq: "Multiple Choice",
  scramble: "Scramble",
};

const levelLabels: Record<AppSettings["level"], string> = {
  A1: "A1",
  A2: "A2",
  B1: "B1",
  B2: "B2",
};

export function TopBar({
  settings,
  onSettingsChange,
  stats,
  onResetProgress,
  matchingSetSize,
  onMatchingSetSizeChange,
  matchingSeed,
}: TopBarProps) {
  const maxOptions = useMemo(
    () =>
      MAX_ITEMS_CHOICES.map((value) => ({
        value,
        label: value === "all" ? "All" : value.toString(),
      })),
    [],
  );

  const handleSettingChange = <Key extends keyof AppSettings>(key: Key, value: AppSettings[Key]) => {
    onSettingsChange({
      ...settings,
      [key]: value,
    });
  };

  const statsLabel = `${stats.correct}/${stats.total}`;

  return (
    <header className="top-bar">
      <div className="top-bar__group">
        <label className="top-bar__field">
          <span className="top-bar__label">Exercise Type</span>
          <select
            value={settings.exerciseType}
            onChange={(event) =>
              handleSettingChange("exerciseType", event.target.value as AppSettings["exerciseType"])
            }
          >
            {Object.entries(typeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="top-bar__field">
          <span className="top-bar__label">Level</span>
          <select
            value={settings.level}
            onChange={(event) =>
              handleSettingChange("level", event.target.value as AppSettings["level"])
            }
          >
            {Object.entries(levelLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="top-bar__field">
          <span className="top-bar__label">Shuffle</span>
          <input
            aria-label="Shuffle items"
            type="checkbox"
            checked={settings.shuffle}
            onChange={(event) => handleSettingChange("shuffle", event.target.checked)}
          />
        </label>
        <label className="top-bar__field">
          <span className="top-bar__label">Max Items</span>
          <select
            value={settings.maxItems === "all" ? "all" : settings.maxItems.toString()}
            onChange={(event) => {
              const raw = event.target.value;
              handleSettingChange("maxItems", raw === "all" ? "all" : Number.parseInt(raw, 10));
            }}
          >
            {maxOptions.map((option) => {
              const value = option.value === "all" ? "all" : option.value.toString();
              return (
                <option key={value} value={value}>
                  {option.label}
                </option>
              );
            })}
          </select>
        </label>
        {settings.exerciseType === "matching" && (
          <label className="top-bar__field">
            <span className="top-bar__label">Pairs per Set</span>
            <input
              type="number"
              min={2}
              max={12}
              step={1}
              value={matchingSetSize}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                onMatchingSetSizeChange(Number.isNaN(parsed) ? matchingSetSize : parsed);
              }}
            />
          </label>
        )}
        {settings.exerciseType === "matching" && matchingSeed && (
          <div className="top-bar__field">
            <span className="top-bar__label">Deterministic shuffle</span>
            <div className="top-bar__badge">
              <code>{matchingSeed}</code>
              <button
                type="button"
                className="top-bar__copy"
                onClick={() => {
                  if (typeof navigator !== "undefined" && navigator.clipboard) {
                    navigator.clipboard.writeText(matchingSeed).catch(() => {
                      /* ignore clipboard failures */
                    });
                  }
                }}
                aria-label="Copy matching seed"
              >
                Copy
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="top-bar__group top-bar__group--right">
        <div className="top-bar__stats" aria-live="polite">
          Correct: <strong>{statsLabel}</strong>
        </div>
        <button type="button" className="top-bar__reset" onClick={onResetProgress}>
          Reset progress
        </button>
      </div>
    </header>
  );
}
