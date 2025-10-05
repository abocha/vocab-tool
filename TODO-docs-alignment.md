# TODO — Align Implementation with Docs

## Pack Inspector & Session Controls
- [x] Add gap-fill controls for mode, bank size, hints, difficulty, and max blanks per sentence as defined in `docs/05-pack-inspector-ui.md` (Gap-Fill Controls section). Update the Pack Inspector UI (`src/components/PackInspector.tsx`) and supporting types/state to surface and persist these controls.
- [x] Persist the new gap-fill control state (mode, bank size, hints, difficulty, blanks-per-sentence) using the inspector storage helpers (`src/lib/storage.ts`) and thread the values into learner components (`src/pages/Home.tsx`, `src/components/GapFill.tsx`).
- [x] Implement presets that capture filters + inspector controls and expose “Duplicate with new seed” for teachers, matching the Presets spec in `docs/05-pack-inspector-ui.md`. This likely requires new preset storage, UI affordances, and deterministic reseeding support beyond the existing matching seed badge.

## Gap-Fill Experience & Data
- [x] Extend gap-fill items to support multi-answer `answers`, `gap_mode`, `bank`, and `hints` columns per `docs/03-csv-pack-spec.md`. Update the loader (`src/lib/csv.ts`), types (`src/types.ts`), and learner UI (`src/components/GapFill.tsx`) to parse and display these additions (including word-bank rendering and optional hints).
- [x] Enforce “Max blanks per sentence 1-2” from `docs/05-pack-inspector-ui.md` within the builders/inspector workflow.

## Cards & Builders
- [x] Align the card schema emitted by `scripts/corpus-to-cards.js` with `docs/06-cards-data-model.md` (collocations stored as arrays of `{anchor, partner, score}`, add `distractors`, optional `flags`).
- [x] Implement the deterministic Gap Strategy Engine and builder outputs described in `docs/08-exercise-builders-from-cards.md`, including gap mode tagging, word-bank generation, hints, and rule-aware distractors in `scripts/cards-to-packs.js`.
- [x] Add the scramble builder so packs include `scramble.csv` generated from level-filtered sentences, per `docs/08-exercise-builders-from-cards.md`.
- [x] Update generated CSVs to remain backward-compatible while emitting additional metadata needed by the frontend (Gap Fill banks/hints, matching metadata if required).

## Validators
- [ ] Expand `scripts/packs-validate.js` to cover the watchdog checks in `docs/09-validators.md` (POS consistency, morphology, MinHash duplicates, bank validity, gap-mode sanity, toxicity guards, Zipf band enforcement, sampling QA summaries, etc.) and surface failures in inspector diagnostics.

## Exports & Publishing
- [x] Enhance export builders (`src/lib/inspector.ts`) so printable HTML honors the “selected hints” and answer-key toggles described in `docs/12-exports-and-publishing.md`.

## Types, Tests, & QA
- [x] Update shared types (`src/types.ts`) and storage schemas to reflect new data fields (cards, exercises, presets, hints, banks, gap modes).
- [x] Add/extend tests (Vitest + CLI smoke tests) that cover the new inspector workflows, CSV parsing branches, builders, and validators to lock the documented behaviour.

Track each item with linked issues/PRs as implementation progresses to keep docs and code in sync.
