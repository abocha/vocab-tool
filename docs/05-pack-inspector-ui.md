# Pack Inspector UI (Teacher Controls)

## Goal

Provide a lightweight review layer inside the app to curate packs for a session.

## Scope (MVP)

- List view for current (level, type).
- Controls: Shuffle, Max Items, Hide/Keep item toggles.
- Quick filters: length range, contains word, regex (optional).
- Export: save filtered subset to CSV (client-side download).

## Controls

### Gap-Fill Controls

- Gap Mode: select target-lexis / collocation / grammar-slot
- Bank Size: 4-8 (default by difficulty)
- Hints: checkboxes [initial letter] [POS] [collocation cue] [TTS]
- Difficulty: A1 / A2 / B1 (sets Zipf band + defaults)
- Max blanks per sentence: 1-2

## Presets

- Presets capture: filters, seed, pairs-per-set, gap controls (mode, bank size, hints, difficulty).
- One-click "Duplicate with new seed" for homework variants.
- Preset library will surface common grammar/vocab targets for quick start (Phase 2).

## Non-Goals

- Editing the underlying CSV on disk.
- Full text editing of items (postpone).

## Acceptance Criteria

- Teacher can curate a 20–50 item subset in <5 minutes.
- Exported CSV opens in Excel/Sheets and can replace the pack for a session.
- Matching view exposes a numeric “Pairs per Set” control (2–12, default 6) persisted to `localStorage` (`matching.setSize`) unless overridden via `?set=<n>`.
- If the page is loaded with `?seed=<value>`, grouping remains deterministic for that seed and the UI surfaces a copyable badge for teachers.
