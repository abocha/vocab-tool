# Frontend MVP Overview (Vite + React + TS)

## What Exists (from Codex)

- Single-page app with:
  - Level/Type selectors (TopBar).
  - Four components: GapFill, Matching, Mcq, Scramble.
  - CSV parsing utils, ID generation, normalization, localStorage persistence.
  - Sample packs + helper `prepare-packs.js`.
  - README with dev/build instructions.

## UX Expectations

- Clear controls; keyboard accessible; visible focus.
- Stats: Correct / Total; Reset Progress.
- Footer attribution shown on every screen.

## Data Flow

- Fetch CSV → parse (PapaParse) → normalize → in-memory list.
- Item ID = stable hash of `{type|prompt|answer}` (or equivalent).
- Progress: `localStorage` under `esl-vocab-mvp/*`.
- Matching packs load as flat pairs; grouping into sets happens at render time using a deterministic seed (URL `?seed` overrides, `localStorage` stores `matching.setSize`).

## Known Gaps (to iterate)

- Matching UX: CSVs must provide one pair per row. Legacy set-per-row files are rejected at load time; convert them before import.
- Empty/error states: clear messages; retry affordance.
- Large CSVs: sampling and pagination toggles (client-side).
- Basic a11y sanity checks (labels, ARIA where needed).

## Acceptance Criteria

- App runs with sample packs; switching level/type does not reload the page.
- Progress persists across refresh; Reset clears state.
- CSV errors do not crash UI; show a helpful message.

## MVP Components

### Gap-Fill Enhancements (MVP+)

- **Gap Mode:** target-lexis | collocation | grammar-slot
- **Word-bank (default A1/A2):** bank size 4-8, rule-aware distractors
- **Hints:** initial letter, POS, collocation cue, optional TTS
- **Difficulty presets:** A1/A2/B1 (sets Zipf band, bank size, hints)
- **Determinism:** all choices seeded; same inputs -> same outputs

## State/Params

- Inspector presets persisted (filters + seed + pairs-per-set + gap mode + bank size + hints).
- `?seed=` continues to control grouping and gap selection deterministically.
