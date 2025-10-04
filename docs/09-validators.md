# Validators (Watchdogs)

## Purpose

Cheap heuristics to flag low-quality items and protect the learner experience.

## Checks

- **Length**: sentences within bounds (e.g., 40–120 chars).
- **Lexical rarity**: % tokens above Zipf threshold per level.
- **POS consistency**: MCQ/distractors share POS; matching pairs valid.
- **Morphology**: distractors not trivial variants; avoid headword stem.
- **Duplicates**: MinHash/normalized text dedup within a pack.
- **Toxicity/basic safety**: banned list; skip sensitive topics.
- **Attribution presence**: `source` and `license` non-empty.

### Gap-Fill Specific

- Bank validity: all options share required POS/morph; distractors not identical to answer.
- Banned blanks: reject rows where the blank token has avoid_as_blank, is a proper noun/number/date, or falls outside Zipf band for the chosen difficulty (unless grammar mode).
- Collocation sanity: if gap_mode=collocation, ensure the partner token appears in the sentence.

### Sampling QA

- Offline sample (N≈200–500) to track estimated first-try success:
  - A1/A2 word-bank: 60–80% first-try
  - A2 open cloze: 30–50%

## Outputs

- Flag items with `needs_review: true` (or exclude from packs).
- Summary report per build (counts by failure type).

## Acceptance Criteria

- ≥95% of exported items pass all validators.
- Failures are inspectable via Pack Inspector filters.
