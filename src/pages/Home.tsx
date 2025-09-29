import { useCallback, useEffect, useMemo, useState } from "react";
import { loadExercises, type PackIssue } from "../lib/csv";
import { applyInspectorFilters } from "../lib/inspector";
import {
  getDefaultSettings,
  loadProgress,
  loadSettings,
  recordProgress,
  resetProgress,
  saveSettings,
} from "../lib/storage";
import type {
  AppSettings,
  ExerciseItem,
  InspectorFilters,
  ProgressMap,
} from "../types";
import { TopBar } from "../components/TopBar";
import { Footer } from "../components/Footer";
import { GapFill } from "../components/GapFill";
import { Matching } from "../components/Matching";
import { Mcq } from "../components/Mcq";
import { Scramble } from "../components/Scramble";
import { PackInspector } from "../components/PackInspector";

const DEFAULT_SETTINGS = getDefaultSettings();
const DEFAULT_FILTERS: InspectorFilters = {
  contains: "",
  minLength: null,
  maxLength: null,
};

type LoadState = "idle" | "loading" | "ready" | "error";

function shuffleItems<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function Home() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [progress, setProgress] = useState<ProgressMap>(() => loadProgress());
  const [items, setItems] = useState<ExerciseItem[]>([]);
  const [displayItems, setDisplayItems] = useState<ExerciseItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [state, setState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [packIssues, setPackIssues] = useState<PackIssue[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [inspectorFilters, setInspectorFilters] = useState<InspectorFilters>(() => ({
    ...DEFAULT_FILTERS,
  }));
  const [hiddenItemIds, setHiddenItemIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchExercises() {
      setState("loading");
      setErrorMessage(null);
      try {
        const loaded = await loadExercises(settings.level, settings.exerciseType);
        if (cancelled) {
          return;
        }
        setItems(loaded.items);
        setPackIssues(loaded.issues);
        setRowCount(loaded.rowCount);
        setState("ready");
      } catch (error) {
        console.warn(error);
        if (!cancelled) {
          setItems([]);
          setPackIssues([
            {
              severity: "error",
              message: "Unable to load exercises. Please check that the CSV pack exists.",
              hint: error instanceof Error ? error.message : undefined,
            },
          ]);
          setState("error");
          setErrorMessage("Unable to load exercises. Please check that the CSV pack exists.");
        }
      }
    }

    fetchExercises();

    return () => {
      cancelled = true;
    };
  }, [settings.level, settings.exerciseType]);

  useEffect(() => {
    setInspectorFilters({ ...DEFAULT_FILTERS });
    setHiddenItemIds(new Set());
  }, [settings.level, settings.exerciseType]);

  const filteredItems = useMemo(
    () => applyInspectorFilters(items, inspectorFilters, hiddenItemIds),
    [items, inspectorFilters, hiddenItemIds],
  );

  const preparedItems = useMemo(() => {
    let nextItems = [...filteredItems];
    if (settings.shuffle) {
      nextItems = shuffleItems(nextItems);
    }
    if (settings.maxItems !== "all") {
      nextItems = nextItems.slice(0, settings.maxItems);
    }
    return nextItems;
  }, [filteredItems, settings.shuffle, settings.maxItems]);

  const matchingMaxPairs = useMemo(() => {
    if (items.length === 0) {
      return 0;
    }
    return items.reduce((maxPairs, current) => {
      if (current.type !== "matching") {
        return maxPairs;
      }
      return Math.max(maxPairs, current.pairs.length);
    }, 0);
  }, [items]);

  useEffect(() => {
    setDisplayItems(preparedItems);
    setCurrentIndex(0);
  }, [preparedItems]);

  const currentItem = displayItems[currentIndex];

  const stats = useMemo(() => {
    const total = displayItems.length;
    const correct = displayItems.reduce((count, item) => {
      if (progress[item.id]?.correct) {
        return count + 1;
      }
      return count;
    }, 0);
    return { correct, total };
  }, [displayItems, progress]);

  const warningIssues = useMemo(
    () => packIssues.filter((issue) => issue.severity === "warning"),
    [packIssues],
  );

  const errorIssues = useMemo(
    () => packIssues.filter((issue) => issue.severity === "error"),
    [packIssues],
  );

  const handleSettingsChange = useCallback((next: AppSettings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const handleResult = useCallback(
    (item: ExerciseItem, wasCorrect: boolean) => {
      setProgress((prev) =>
        recordProgress(prev, item.id, {
          correct: wasCorrect,
          seenAt: new Date().toISOString(),
        }),
      );
    },
    [],
  );

  const handleNext = useCallback(() => {
    setCurrentIndex((index) => {
      if (displayItems.length === 0) {
        return 0;
      }
      return (index + 1) % displayItems.length;
    });
  }, [displayItems.length]);

  const handleResetProgress = useCallback(() => {
    if (window.confirm("Reset stored progress?")) {
      resetProgress();
      setProgress({});
    }
  }, []);

  const handleFiltersChange = useCallback((nextFilters: InspectorFilters) => {
    setInspectorFilters(nextFilters);
  }, []);

  const handleResetFilters = useCallback(() => {
    setInspectorFilters({ ...DEFAULT_FILTERS });
  }, []);

  const handleToggleHidden = useCallback((itemId: string) => {
    setHiddenItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const handleClearHidden = useCallback(() => {
    setHiddenItemIds(new Set());
  }, []);

  useEffect(() => {
    if (settings.exerciseType !== "matching") {
      return;
    }
    if (matchingMaxPairs === 0) {
      return;
    }
    if (settings.matchingPairLimit !== 0 && settings.matchingPairLimit > matchingMaxPairs) {
      handleSettingsChange({ ...settings, matchingPairLimit: 0 });
    }
  }, [settings, matchingMaxPairs, handleSettingsChange]);

  let content: React.ReactNode = null;

  if (state === "loading") {
    content = <p>Loading exercises…</p>;
  } else if (state === "error") {
    content = (
      <div className="app-message">
        <p>{errorMessage}</p>
        {errorIssues.length > 0 && (
          <ul>
            {errorIssues.map((issue) => (
              <li key={issue.message}>
                {issue.message}
                {issue.hint ? ` (${issue.hint})` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  } else if (currentItem) {
    const existingResult = progress[currentItem.id]?.correct;

    switch (currentItem.type) {
      case "gapfill":
        content = (
          <GapFill
            item={currentItem}
            onResult={(result) => handleResult(currentItem, result)}
            onNext={handleNext}
            existingResult={existingResult}
          />
        );
        break;
      case "matching":
        content = (
          <Matching
            item={currentItem}
            onResult={(result) => handleResult(currentItem, result)}
            onNext={handleNext}
            existingResult={existingResult}
            pairLimit={settings.matchingPairLimit}
          />
        );
        break;
      case "mcq":
        content = (
          <Mcq
            item={currentItem}
            onResult={(result) => handleResult(currentItem, result)}
            onNext={handleNext}
            existingResult={existingResult}
          />
        );
        break;
      case "scramble":
        content = (
          <Scramble
            item={currentItem}
            onResult={(result) => handleResult(currentItem, result)}
            onNext={handleNext}
            existingResult={existingResult}
          />
        );
        break;
      default:
        content = <p className="app-message">Unsupported exercise type.</p>;
    }
  } else if (state === "ready" && displayItems.length === 0) {
    content = (
      <div className="app-message">
        <p>No exercises available for this selection.</p>
        <p>Adjust Pack Inspector filters or verify the CSV columns for this level and exercise type.</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      <TopBar
        settings={settings}
        onSettingsChange={handleSettingsChange}
        stats={stats}
        onResetProgress={handleResetProgress}
        matchingMaxPairs={matchingMaxPairs}
      />
      <main className="app-main" aria-live="polite">
        {state === "ready" && (warningIssues.length > 0 || rowCount === 0) && (
          <aside className="app-banner" role="status">
            <div>
              {rowCount > 0
                ? `Parsed ${rowCount} rows → ${items.length} valid → ${filteredItems.length} after filters. Showing ${displayItems.length} in session.`
                : "No rows parsed from the CSV pack."}
            </div>
            {warningIssues.length > 0 && (
              <ul>
                {warningIssues.map((issue) => (
                  <li key={issue.message}>{issue.message}</li>
                ))}
              </ul>
            )}
          </aside>
        )}
        {content}
      </main>
      <PackInspector
        allItems={items}
        filteredItems={filteredItems}
        visibleItems={displayItems}
        hiddenIds={hiddenItemIds}
        filters={inspectorFilters}
        onFiltersChange={handleFiltersChange}
        onResetFilters={handleResetFilters}
        onToggleHidden={handleToggleHidden}
        onClearHidden={handleClearHidden}
        settings={settings}
        onSettingsChange={handleSettingsChange}
        level={settings.level}
        exerciseType={settings.exerciseType}
        rowCount={rowCount}
      />
      <Footer />
    </div>
  );
}
