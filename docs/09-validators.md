# Validators (Watchdogs)

## Purpose

Cheap heuristics to flag low-quality items and protect the learner experience.

## Checks

- **Length**: sentences within bounds (e.g., 40–120 chars).
- **Lexical rarity**: % tokens above Zipf threshold per level.
- **POS consistency**: MCQ distractors (and answers) share a rough POS; matching pairs remain well-formed.
- **Morphology**: distractors not trivial variants; avoid headword stem.
- **Duplicates**: MinHash/normalized text dedup within a pack.
- **Toxicity/basic safety**: banned list; skip sensitive topics.
- **Attribution presence**: `source` and `license` non-empty.
- **Bank hygiene** (gap-fill): options unique, POS/morph match the slot, no stray stopwords unless grammar mode, bank size ≥ minimum, answer present; relaxor usage tracked.
- **Matching shape**: each row must be a single pair (`left,right`). Legacy set-per-row rows are rejected as `invalid_format` and reported in the summary.
- **Near-duplicates**: fuzzy match prompts/options to spot near-identical items for review.

### Telemetry

- Bank counts per file and globally.
- Relaxed-bank usage (how often the fallback fired).
- Tag mix (`colloc`, `neighbor`, `curated`, `family`, etc.).
- Per-level and per-preset aggregation (counts, tag mix, size histogram) sourced from `bank_meta`.
- Bank-size histogram to keep pack settings honest.

### Gap-Fill Specific

- Bank validity: all options share required POS/morph (using the exported `bank_meta.slot` when available); distractors not identical to answer.
- Banned blanks: reject rows where the blank token has avoid_as_blank, is a proper noun/number/date, or falls outside Zipf band for the chosen difficulty (unless grammar mode).
- Collocation sanity: if gap_mode=collocation, ensure the partner token appears in the sentence.
- Near-duplicate prompts: fuzzy-matching prompts are surfaced for manual QA.

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
