# Exercise Builders from Cards

## Goal

Pure functions that emit CSVs in the MVP app format from a list of `Card` objects.

## Builders

- `buildGapFill(cards)` → `gapfill.csv`
  - Use card examples; blank exactly one target token.
- `buildMatching(cards)` → `matching.csv`
  - Compose sets from collocations (left/right); support both pack shapes.
- `buildMCQ(cards)` → `mcq.csv`
  - Use example cloze; distractors from card’s distractors or collocation neighbors with same POS.
- `buildScramble(sentences)` → `scramble.csv`
  - Use level-filtered sentences; shuffle words.

## Constraints

- Deterministic; no API calls; stable outputs for the same inputs.
- Preserve `source` and `license`.

## Acceptance Criteria

- Builders create packs the MVP app can load with zero code changes.
- Regenerating after card edits updates exercises idempotently.
