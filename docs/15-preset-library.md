# Preset Library (Phase 2)

## Goals

Provide teachers and content designers with ready-to-use configurations that align filters, inspector controls, and builder knobs for common grammar/vocabulary targets. Presets must be deterministic, easy to maintain, and forward-compatible with future activities.

## File Layout

```
presets/
  library.json          # curated presets shipped with the app
  README.md             # contributor guidance (optional)
```

The build step copies `presets/library.json` into the bundle. Library presets are read-only at runtime; user-created presets continue to live in `localStorage` (`esl-vocab-mvp/inspector-presets`).

## JSON Schema

```ts
interface PresetDefinition {
  /** Stable, url-safe identifier (kebab-case). */
  id: string;
  /** Human-friendly label shown in the UI. */
  label: string;
  /** Optional short description (markdown-lite). */
  description?: string;
  /** Preset version for cache-busting (increment when behaviour changes). */
  version: number;
  /** Categorisation tags (e.g., "grammar", "lexis", "test-prep"). */
  tags?: string[];
  /** Exercise types this preset targets (at least one). */
  exerciseTypes: ("gapfill" | "matching" | "mcq" | "scramble")[];
  /** Supported learner levels; used for filtering in the UI. */
  levels: ("A1" | "A2" | "B1" | "B2")[];
  /** Inspector filters to apply. Missing keys fall back to defaults. */
  filters?: {
    contains?: string;
    minLength?: number | null;
    maxLength?: number | null;
    regex?: string;
    bankQuality?: "all" | "solid" | "soft" | "needs_review";
    relaxedOnly?: boolean;
  };
  /** Gap-fill inspector controls to apply (optional for non gap-fill presets). */
  gapFill?: {
    mode?: "target" | "collocation" | "grammar";
    bankSize?: number;
    hints?: {
      initialLetter?: boolean;
      pos?: boolean;
      collocationCue?: boolean;
      tts?: boolean;
    };
    difficulty?: "A1" | "A2" | "B1";
    maxBlanksPerSentence?: 1 | 2;
  };
  /** Matching-specific controls. */
  matching?: {
    setSize?: number;
    seedStrategy?: "preserve" | "regen";
  };
  /** Global inspector settings overrides (shuffle, max items, etc.). */
  settings?: {
    shuffle?: boolean;
    maxItems?: number | "all";
    seedStrategy?: "preserve" | "regen" | { type: "fixed"; seed: string };
  };
  /**
   * Optional builder hints. When present, cards-to-packs can toggle extra
   * heuristics (e.g., enforce grammar mode, restrict lexis lists, prefer
   * curated distractors).
   */
  builder?: {
    gapfill?: {
      enforceMode?: "target" | "collocation" | "grammar";
      allowFunctionWords?: boolean;
      extraFamilies?: string[];
    };
    matching?: {
      pairLimit?: number;
    };
  };
}
```

`library.json` wraps these definitions:

```json
{
  "libraryVersion": 1,
  "updated": "2025-03-05",
  "presets": [
    {
      "id": "present-simple-verb",
      "label": "Present Simple (verbs)",
      "description": "Target third-person singular verb forms in day-to-day contexts.",
      "version": 1,
      "tags": ["grammar", "verb"],
      "exerciseTypes": ["gapfill"],
      "levels": ["A2", "B1"],
      "filters": {
        "regex": "\\b(s|es)\\b",
        "bankQuality": "solid"
      },
      "gapFill": {
        "mode": "grammar",
        "bankSize": 6,
        "hints": { "pos": true },
        "difficulty": "A2",
        "maxBlanksPerSentence": 1
      },
      "settings": {
        "shuffle": false,
        "maxItems": 20,
        "seedStrategy": "regen"
      },
      "builder": {
        "gapfill": {
          "enforceMode": "grammar",
          "allowFunctionWords": true,
          "extraFamilies": ["lightVerbs", "timePreps"]
        }
      }
    }
  ]
}
```

## Loader & Versioning

- `preset-library.ts` (to be implemented) should load `library.json`, validate it, and expose:
  - `getPresetById(id)`
  - `listPresets({ level?, exerciseType?, tags? })`
  - `libraryVersion`
- The loader caches results in-memory. When `libraryVersion` changes, downstream caches (localStorage snapshots) must be invalidated.
- Builder-side integrations read the same manifest (via Node `import`) to apply preset-specific heuristics when requested (CLI flag `--preset <id>`).

## UI Behaviour Summary

- Library presets appear in a left-rail list grouped by `tags`.
- Hover/expand shows description + change summary (filters, controls, builder hints).
- “Apply” merges preset values onto current inspector state. When a preset is active, the inspector header shows the preset name with a reset action.
- Custom presets continue to use the existing storage format; applying a library preset optionally saves a personalised copy.

## Testing & QA

- Add unit tests for manifest parsing (invalid schema, unknown fields, missing IDs).
- Inspector integration tests should confirm that applying a preset updates filters/controls and logs an analytics event.
- Validator telemetry can be filtered by preset ID when packs are generated with `--preset` (future work).

Refer back to this document when implementing the loader, UI, and builder hooks in Phase 2.
