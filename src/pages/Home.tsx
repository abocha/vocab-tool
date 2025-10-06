import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { loadExercises, type MatchingDiagnostics, type PackIssue } from "../lib/csv";
import { applyInspectorFilters, compileInspectorRegex } from "../lib/inspector";
import {
  clampSetSize,
  DEFAULT_MATCHING_SET_SIZE,
  deriveMatchingSeed,
  groupPairsIntoSets,
} from "../lib/matching";
import { createItemId } from "../lib/id";
import {
  getLibraryMetadata,
  getLibraryPreset,
  listLibraryPresets,
  type PresetSummary,
} from "../lib/preset-library";
import {
  getDefaultGapFillControls,
  getDefaultInspectorFilters,
  getDefaultInspectorState,
  getDefaultSettings,
  loadInspectorPresets,
  loadInspectorState,
  loadProgress,
  loadSettings,
  loadMatchingSetSize,
  recordProgress,
  resetProgress,
  saveInspectorPresets,
  saveMatchingSetSize,
  saveInspectorState,
  saveSettings,
} from "../lib/storage";
import type {
  AppSettings,
  ExerciseItem,
  InspectorFilters,
  InspectorPreset,
  MatchingItem,
  MatchingPair,
  ProgressMap,
  GapFillInspectorControls,
  PresetSeedStrategy,
} from "../types";
import { TopBar } from "../components/TopBar";
import { Footer } from "../components/Footer";
import { GapFill } from "../components/GapFill";
import { Matching } from "../components/Matching";
import { Mcq } from "../components/Mcq";
import { Scramble } from "../components/Scramble";
import { PackInspector } from "../components/PackInspector";

const DEFAULT_SETTINGS = getDefaultSettings();
const DEFAULT_INSPECTOR_STATE = getDefaultInspectorState();

type LoadState = "idle" | "loading" | "ready" | "error";

function shuffleItems<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildMatchingItemsFromPairs({
  pairs,
  setSize,
  seed,
  level,
}: {
  pairs: MatchingPair[];
  setSize: number;
  seed: string;
  level: AppSettings["level"];
}): MatchingItem[] {
  const grouped = groupPairsIntoSets(pairs, setSize, seed);
  return grouped.map((group, index) => {
    const key = group.map((pair) => `${pair.left}|${pair.right}`).join("||");
    const id = createItemId("matching", `${seed}|${index}|${key}`);
    const first = group[0];
    return {
      id,
      type: "matching",
      pairs: group,
      seed,
      setId: `${index}`,
      source: first?.source,
      license: first?.license,
      level: (first?.level as AppSettings["level"]) ?? level,
    };
  });
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
  const [inspectorFilters, setInspectorFilters] = useState<InspectorFilters>(() =>
    getDefaultInspectorFilters(),
  );
  const [hiddenItemIds, setHiddenItemIds] = useState<Set<string>>(() => new Set());
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(DEFAULT_INSPECTOR_STATE.isOpen);
  const [packFingerprint, setPackFingerprint] = useState<string | null>(null);
  const [showInspectorDetails, setShowInspectorDetails] = useState<boolean>(
    DEFAULT_INSPECTOR_STATE.showDetails,
  );
  const [showInspectorInfo, setShowInspectorInfo] = useState<boolean>(
    DEFAULT_INSPECTOR_STATE.showInfo,
  );
  const [gapFillControls, setGapFillControls] = useState<GapFillInspectorControls>(
    getDefaultGapFillControls(),
  );
  const [presets, setPresets] = useState<InspectorPreset[]>([]);
  const [matchingDiagnostics, setMatchingDiagnostics] = useState<MatchingDiagnostics | null>(null);
  const [matchingPairs, setMatchingPairs] = useState<MatchingPair[]>([]);
  const [matchingSetSize, setMatchingSetSize] = useState<number>(DEFAULT_MATCHING_SET_SIZE);
  const [matchingSeed, setMatchingSeed] = useState<string | null>(null);
  const [activeLibraryPresetId, setActiveLibraryPresetId] = useState<string | null>(null);
  const urlSetSizeRef = useRef<number | null>(null);
  const urlSeedRef = useRef<string | null>(null);
  const inspectorHydratedRef = useRef(false);
  const libraryApplicationRef = useRef(false);
  const deferredRegex = useDeferredValue(inspectorFilters.regex);
  const { regex: compiledRegex, error: compiledRegexError } = useMemo(
    () => compileInspectorRegex(deferredRegex),
    [deferredRegex],
  );

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const setParam = params.get("set");
    const seedParam = params.get("seed");

    let initialSize = DEFAULT_MATCHING_SET_SIZE;
    if (setParam) {
      const parsed = Number.parseInt(setParam, 10);
      if (!Number.isNaN(parsed)) {
        const clamped = clampSetSize(parsed);
        urlSetSizeRef.current = clamped;
        initialSize = clamped;
      }
    } else {
      const stored = loadMatchingSetSize();
      if (stored != null) {
        initialSize = clampSetSize(stored);
      }
    }
    setMatchingSetSize(initialSize);

    if (seedParam) {
      urlSeedRef.current = seedParam;
      setMatchingSeed(seedParam);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchExercises() {
      setState("loading");
      setErrorMessage(null);
      setPackFingerprint(null);
      setMatchingDiagnostics(null);
      try {
        const loaded = await loadExercises(settings.level, settings.exerciseType);
        if (cancelled) {
          return;
        }
        if (settings.exerciseType === "matching") {
          const pairs = loaded.matchingPairs ?? [];
          setMatchingPairs(pairs);
          const derivedSeed =
            urlSeedRef.current ??
            deriveMatchingSeed({
              level: settings.level,
              fileName: "matching.csv",
              pairCount: pairs.length,
              fingerprint: loaded.fingerprint,
            });
          setMatchingSeed(derivedSeed);
          const effectiveSize = clampSetSize(urlSetSizeRef.current ?? matchingSetSize);
          const grouped = buildMatchingItemsFromPairs({
            pairs,
            setSize: effectiveSize,
            seed: derivedSeed,
            level: settings.level,
          });
          setItems(grouped);
        } else {
          setMatchingPairs([]);
          setMatchingSeed(null);
          setItems(loaded.items);
        }
        setPackIssues(loaded.issues);
        setRowCount(loaded.rowCount);
        setPackFingerprint(loaded.fingerprint);
        setMatchingDiagnostics(loaded.matchingDiagnostics ?? null);
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
          setPackFingerprint(null);
          setMatchingDiagnostics(null);
        }
      }
    }

    fetchExercises();

    return () => {
      cancelled = true;
    };
  }, [settings.level, settings.exerciseType]);

  useEffect(() => {
    if (settings.exerciseType !== "matching") {
      return;
    }
    const seedToUse =
      urlSeedRef.current ??
      matchingSeed ??
      deriveMatchingSeed({
        level: settings.level,
        fileName: "matching.csv",
        pairCount: matchingPairs.length,
        fingerprint: packFingerprint,
      });
    if (matchingSeed == null && seedToUse) {
      setMatchingSeed(seedToUse);
    }
    const grouped = buildMatchingItemsFromPairs({
      pairs: matchingPairs,
      setSize: matchingSetSize,
      seed: seedToUse,
      level: settings.level,
    });
    setItems(grouped);
  }, [
    settings.exerciseType,
    matchingPairs,
    matchingSetSize,
    matchingSeed,
    settings.level,
    packFingerprint,
  ]);

  useEffect(() => {
    inspectorHydratedRef.current = false;
    if (!packFingerprint) {
      setInspectorFilters(getDefaultInspectorFilters());
      setHiddenItemIds(new Set());
      setIsInspectorOpen(DEFAULT_INSPECTOR_STATE.isOpen);
      setShowInspectorDetails(DEFAULT_INSPECTOR_STATE.showDetails);
      setShowInspectorInfo(DEFAULT_INSPECTOR_STATE.showInfo);
      setGapFillControls(getDefaultGapFillControls());
      return;
    }
    const persisted = loadInspectorState(settings.level, settings.exerciseType, packFingerprint);
    setInspectorFilters({ ...persisted.filters });
    setHiddenItemIds(new Set(persisted.hiddenIds));
    setIsInspectorOpen(persisted.isOpen);
    setShowInspectorDetails(persisted.showDetails);
    setShowInspectorInfo(persisted.showInfo);
    setGapFillControls({ ...persisted.gapFill });
    inspectorHydratedRef.current = true;
  }, [packFingerprint, settings.level, settings.exerciseType]);

  useEffect(() => {
    setPresets(loadInspectorPresets(settings.level, settings.exerciseType));
  }, [settings.level, settings.exerciseType]);

  const filteredItems = useMemo(
    () =>
      applyInspectorFilters(items, inspectorFilters, hiddenItemIds, {
        regex: compiledRegex,
        gapFill: gapFillControls,
      }),
    [items, inspectorFilters, hiddenItemIds, compiledRegex, gapFillControls],
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

  const libraryMetadata = useMemo(() => getLibraryMetadata(), []);
  const libraryPresets: PresetSummary[] = useMemo(
    () =>
      listLibraryPresets({
        level: settings.level,
        exerciseType: settings.exerciseType,
      }),
    [settings.exerciseType, settings.level],
  );

  useEffect(() => {
    setDisplayItems(preparedItems);
    setCurrentIndex(0);
  }, [preparedItems]);

  useEffect(() => {
    setActiveLibraryPresetId(null);
  }, [settings.level, settings.exerciseType]);

  useEffect(() => {
    setHiddenItemIds((prev) => {
      if (prev.size === 0) {
        return prev;
      }
      const validIds = new Set(items.map((item) => item.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (validIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [items]);

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

  const errorIssues = useMemo(
    () => packIssues.filter((issue) => issue.severity === "error"),
    [packIssues],
  );

  const bannerIssues = useMemo(() => {
    const order: Record<PackIssue["severity"], number> = {
      error: 0,
      warning: 1,
      info: 2,
    };
    const filtered = packIssues.filter((issue) =>
      issue.severity === "info" ? showInspectorInfo : true,
    );
    return filtered.sort((a, b) => order[a.severity] - order[b.severity]);
  }, [packIssues, showInspectorInfo]);

  const bannerSummary = useMemo(() => {
    let summary = rowCount > 0
      ? `Parsed ${rowCount} rows → ${items.length} valid → ${filteredItems.length} after filters. Showing ${displayItems.length} in session.`
      : "No rows parsed from the CSV pack.";
    if (settings.exerciseType === "matching" && matchingDiagnostics) {
      summary = `${summary} Matching: pairs ${matchingDiagnostics.pairsParsed}, duplicates dropped ${matchingDiagnostics.duplicatePairsDropped}, invalid rows ${matchingDiagnostics.invalidRows}.`;
    }
    return summary;
  }, [
    rowCount,
    items.length,
    filteredItems.length,
    displayItems.length,
    settings.exerciseType,
    matchingDiagnostics,
  ]);

  const bannerRole = bannerIssues.some((issue) => issue.severity === "error")
    ? "alert"
    : "status";

  const severityLabel: Record<PackIssue["severity"], string> = {
    error: "Error",
    warning: "Warning",
    info: "Info",
  };

  const handleSettingsChange = useCallback(
    (next: AppSettings) => {
      setSettings(next);
      saveSettings(next);
      if (!libraryApplicationRef.current) {
        setActiveLibraryPresetId(null);
      }
    },
    [],
  );

  const handleMatchingSetSizeChange = useCallback((value: number) => {
    const clamped = clampSetSize(value);
    urlSetSizeRef.current = null;
    setMatchingSetSize(clamped);
    saveMatchingSetSize(clamped);
    if (!libraryApplicationRef.current) {
      setActiveLibraryPresetId(null);
    }
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
    if (!libraryApplicationRef.current) {
      setActiveLibraryPresetId(null);
    }
  }, []);

  const handleResetFilters = useCallback(() => {
    setInspectorFilters(getDefaultInspectorFilters());
    if (!libraryApplicationRef.current) {
      setActiveLibraryPresetId(null);
    }
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
    if (!libraryApplicationRef.current) {
      setActiveLibraryPresetId(null);
    }
  }, []);

  const handleClearHidden = useCallback(() => {
    setHiddenItemIds(new Set());
    if (!libraryApplicationRef.current) {
      setActiveLibraryPresetId(null);
    }
  }, []);

  const handleToggleInspectorOpen = useCallback(() => {
    setIsInspectorOpen((prev) => !prev);
  }, []);

  const handleToggleInspectorDetails = useCallback(() => {
    setShowInspectorDetails((prev) => !prev);
  }, []);

  const handleToggleInspectorInfo = useCallback(() => {
    setShowInspectorInfo((prev) => !prev);
  }, []);

  const handleGapFillControlsChange = useCallback((next: GapFillInspectorControls) => {
    setGapFillControls(next);
    if (!libraryApplicationRef.current) {
      setActiveLibraryPresetId(null);
    }
  }, []);

  const applyMatchingSeedStrategy = useCallback(
    (strategy?: PresetSeedStrategy) => {
      if (!strategy || settings.exerciseType !== "matching") {
        return;
      }
      if (strategy === "preserve") {
        return;
      }
      if (strategy === "regen") {
        const seed = `preset-${Math.random().toString(36).slice(2, 10)}`;
        setMatchingSeed(seed);
        urlSeedRef.current = seed;
        return;
      }
      if (typeof strategy === "object" && strategy.type === "fixed") {
        setMatchingSeed(strategy.seed);
        urlSeedRef.current = strategy.seed;
      }
    },
    [settings.exerciseType],
  );

  const applyPreset = useCallback(
    (preset: InspectorPreset) => {
      setActiveLibraryPresetId(null);
      setInspectorFilters({ ...preset.filters });
      setHiddenItemIds(new Set(preset.hiddenIds ?? []));
      setGapFillControls({ ...preset.gapFill });
      handleSettingsChange({ ...preset.settings });
      handleMatchingSetSizeChange(preset.matchingSetSize);

      if (preset.settings.exerciseType === "matching") {
        const seed = preset.matchingSeed ?? `preset-${Math.random().toString(36).slice(2, 10)}`;
        setMatchingSeed(seed);
        urlSeedRef.current = seed;
      } else {
        setMatchingSeed(null);
        urlSeedRef.current = null;
      }
    },
    [handleMatchingSetSizeChange, handleSettingsChange],
  );

  const handleSavePreset = useCallback(
    (name: string): boolean => {
      const trimmed = name.trim();
      if (!trimmed) {
        return false;
      }

      const id = createItemId(
        settings.exerciseType,
        `${settings.level}|${settings.exerciseType}|${trimmed}|${Date.now()}`,
      );
      const preset: InspectorPreset = {
        id,
        name: trimmed,
        createdAt: new Date().toISOString(),
        filters: { ...inspectorFilters },
        hiddenIds: Array.from(hiddenItemIds),
        gapFill: { ...gapFillControls },
        settings: { ...settings },
        matchingSetSize,
        matchingSeed: settings.exerciseType === "matching" ? matchingSeed ?? undefined : undefined,
      };

      const filtered = presets.filter((entry) => entry.id !== id && entry.name !== trimmed);
      const next = [...filtered, preset].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      setPresets(next);
      saveInspectorPresets(settings.level, settings.exerciseType, next);
      return true;
    },
    [
      gapFillControls,
      hiddenItemIds,
      inspectorFilters,
      matchingSeed,
      matchingSetSize,
      presets,
      settings,
    ],
  );

  const handleApplyPreset = useCallback(
    (presetId: string) => {
      const preset = presets.find((entry) => entry.id === presetId);
      if (!preset) {
        return;
      }
      applyPreset(preset);
    },
    [applyPreset, presets],
  );

  const handleDeletePreset = useCallback(
    (presetId: string) => {
      const next = presets.filter((entry) => entry.id !== presetId);
      setPresets(next);
      saveInspectorPresets(settings.level, settings.exerciseType, next);
    },
    [presets, settings.exerciseType, settings.level],
  );

  const handleDuplicatePreset = useCallback(
    (presetId: string) => {
      const preset = presets.find((entry) => entry.id === presetId);
      if (!preset) {
        return;
      }
      const names = new Set(presets.map((entry) => entry.name));
      let copyNameBase = `${preset.name} (copy)`;
      let counter = 2;
      while (names.has(copyNameBase)) {
        copyNameBase = `${preset.name} (copy ${counter})`;
        counter += 1;
      }
      const newSeed = preset.settings.exerciseType === "matching"
        ? `preset-${Math.random().toString(36).slice(2, 10)}`
        : preset.matchingSeed;
      const duplicate: InspectorPreset = {
        ...preset,
        id: createItemId(
          preset.settings.exerciseType,
          `${preset.id}|copy|${Date.now()}`,
        ),
        name: copyNameBase,
        createdAt: new Date().toISOString(),
        matchingSeed: newSeed,
      };
      const next = [duplicate, ...presets];
      setPresets(next);
      saveInspectorPresets(settings.level, settings.exerciseType, next);
      applyPreset(duplicate);
    },
    [applyPreset, presets, settings.exerciseType, settings.level],
  );

  const handleApplyLibraryPreset = useCallback(
    (presetId: string) => {
      const preset = getLibraryPreset(presetId);
      if (!preset) {
        return;
      }
      libraryApplicationRef.current = true;
      try {
        setActiveLibraryPresetId(presetId);
        const baseFilters = getDefaultInspectorFilters();
        const nextFilters = preset.filters ? { ...baseFilters, ...preset.filters } : baseFilters;
        setInspectorFilters(nextFilters);
        setHiddenItemIds(new Set());

        if (settings.exerciseType === "gapfill") {
          const baseGap = getDefaultGapFillControls();
          const mergedHints = {
            ...baseGap.hints,
            ...(preset.gapFill?.hints ?? {}),
          };
          const nextGap: GapFillInspectorControls = {
            ...baseGap,
            ...(preset.gapFill ?? {}),
            hints: mergedHints,
          };
          setGapFillControls(nextGap);
        }

        if (settings.exerciseType === "matching") {
          if (preset.matching?.setSize) {
            handleMatchingSetSizeChange(preset.matching.setSize);
          }
          const seedStrategy = preset.matching?.seedStrategy ?? preset.settings?.seedStrategy;
          applyMatchingSeedStrategy(seedStrategy);
        }

        if (preset.settings) {
          const { seedStrategy: _seedStrategy, ...restSettings } = preset.settings;
          const nextSettings: AppSettings = {
            ...settings,
            ...restSettings,
          };
          handleSettingsChange(nextSettings);
        }
      } finally {
        libraryApplicationRef.current = false;
      }
    },
    [
      applyMatchingSeedStrategy,
      handleMatchingSetSizeChange,
      handleSettingsChange,
      settings,
    ],
  );

  useEffect(() => {
    if (!inspectorHydratedRef.current) {
      return;
    }
    if (!packFingerprint) {
      return;
    }

    saveInspectorState(settings.level, settings.exerciseType, packFingerprint, {
      filters: inspectorFilters,
      hiddenIds: Array.from(hiddenItemIds),
      isOpen: isInspectorOpen,
      showDetails: showInspectorDetails,
      showInfo: showInspectorInfo,
      gapFill: gapFillControls,
    });
  }, [
    inspectorFilters,
    hiddenItemIds,
    isInspectorOpen,
    showInspectorDetails,
    showInspectorInfo,
    packFingerprint,
    settings.level,
    settings.exerciseType,
    gapFillControls,
  ]);

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
            controls={gapFillControls}
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
        matchingSetSize={matchingSetSize}
        onMatchingSetSizeChange={handleMatchingSetSizeChange}
        matchingSeed={matchingSeed}
      />
      <main className="app-main" aria-live="polite">
        {state === "ready" && (bannerIssues.length > 0 || rowCount === 0) && (
          <aside className="app-banner" role={bannerRole}>
            <div>{bannerSummary}</div>
            {bannerIssues.length > 0 && (
              <ul>
                {bannerIssues.map((issue, index) => (
                  <li key={`banner-${index}`} className={`app-banner__item app-banner__item--${issue.severity}`}>
                    <span className="app-banner__item-label">{severityLabel[issue.severity]}:</span>
                    <span>
                      {issue.message}
                      {issue.hint ? ` (${issue.hint})` : ""}
                    </span>
                  </li>
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
        isOpen={isInspectorOpen}
        onToggleOpen={handleToggleInspectorOpen}
        showDetails={showInspectorDetails}
        onToggleDetails={handleToggleInspectorDetails}
        showInfo={showInspectorInfo}
        onToggleInfo={handleToggleInspectorInfo}
        issues={packIssues}
        settings={settings}
        onSettingsChange={handleSettingsChange}
        level={settings.level}
        exerciseType={settings.exerciseType}
        rowCount={rowCount}
        matchingDiagnostics={matchingDiagnostics}
        regexError={compiledRegexError}
        gapFillControls={gapFillControls}
        onGapFillControlsChange={handleGapFillControlsChange}
        presets={presets}
        onSavePreset={handleSavePreset}
        onApplyPreset={handleApplyPreset}
        onDuplicatePreset={handleDuplicatePreset}
        onDeletePreset={handleDeletePreset}
        libraryPresets={libraryPresets}
        activeLibraryPresetId={activeLibraryPresetId}
        onApplyLibraryPresetFromLibrary={handleApplyLibraryPreset}
        libraryMeta={libraryMetadata}
      />
      <Footer />
    </div>
  );
}
