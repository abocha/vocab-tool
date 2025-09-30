# Exercise Builders from Cards

## Goal

Pure functions that emit CSVs in the MVP app format from a list of `Card` objects.

## Builders

- `buildGapFill(cards)` → `gapfill.csv`
  - Use card examples; blank exactly one target token.
- `buildMatching(cards)` → `matching.csv`
  - Emit one collocate/lemma pair per row. The frontend groups pairs into sets at render time.
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
