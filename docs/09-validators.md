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

## Outputs

- Flag items with `needs_review: true` (or exclude from packs).
- Summary report per build (counts by failure type).

## Acceptance Criteria

- ≥95% of exported items pass all validators.
- Failures are inspectable via Pack Inspector filters.
