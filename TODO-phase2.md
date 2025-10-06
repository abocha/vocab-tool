# TODO — Phase 2: Preset Library & Distractor Expansion

## Preset Library (Grammar & Vocab Targets)
- [x] Define preset schema in docs (preset id, label, gap controls, seed policy) and update `docs/05-pack-inspector-ui.md` accordingly.
- [x] Implement preset registry loader (JSON manifest) and storage helpers (`src/lib/preset-library.ts`) with versioning.
- [x] Add Pack Inspector UI for browsing/applying presets, including preview of affected filters/controls.
- [x] **Builder wiring** — have `cards-to-packs` load preset hints (`builder.gapfill.*`) and emit preset id + slot tags in `bank_meta`.

## Distractor Bank Expansion
- [x] **Curated catalog rollout** — reorganise `confusables.json` into thematic/level-aware pools and plug them into the staged candidate flow.
- [x] **Coverage telemetry** — extend smart-bank scoring to note preset-specific pulls and export counts per tag/level/preset for validator reports.

## QA & Documentation
- [x] Publish phase 2 release notes (README) summarising presets workflow and distractor coverage improvements.
- [x] Create preset usage guide for content team (`docs/15-preset-library.md`).
- [x] Establish QA checklist for preset-driven packs (spot-check banks, telemetry thresholds, relaxed usage).

Track each item with linked issues/PRs to keep docs and code in sync.
