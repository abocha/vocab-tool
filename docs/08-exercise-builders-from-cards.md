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

## Gap Strategy Engine (deterministic)

**Candidate extraction (per sentence)**

- Target-lexis hits (lemma/inflections)
- Collocation anchors from card.collocations
- Grammar-slot tokens when a grammar preset is active (articles, prepositions, be/have/aux)

**Hard filters**

- Skip tokens with flags.avoid_as_blank
- Zipf band gating by difficulty (A1/A2/B1)

**Scoring**
GapScore = +3 target hit
         +2 collocation anchor (score >= threshold)
         +1 Zipf in band
         +1 token length 3-8
         -2 ambiguous/polysemous
         -2 sentence too complex for level

Pick top candidate(s) (max 1-2 blanks/sentence). Tie-break with seed.

**Outputs**

- `gap_mode` recorded.
- Optional `bank` with rule-aware distractors (same POS/morph; plausible confusables).
- Optional `hints`: `pos=...;first=...;cue=...`.

**Determinism**
All choices derive from seed + row id + stable card data. Same inputs → same CSV.

### New exercise type hooks (for later)

Pluggable builders follow the same pattern (pure function → CSV): Sorting/Grouping, Word-bank Cloze (multi-blank), Error-spotting.

## Acceptance Criteria

- Builders create packs the MVP app can load with zero code changes.
- Regenerating after card edits updates exercises idempotently.
