# Adapter: Corpus → Cards

## Inputs

- `freq_lemmas.csv`, `bigrams.csv`, `sentences_<LEVEL>.txt`.
- Optional: `tokens.csv[.gz]` for POS disambiguation.

## Process

1. Select top lemmas by frequency and POS.
2. Attach 1–3 example sentences per lemma (level-gated, deduped).
3. Collocations: derive from bigrams (e.g., ADJ+NOUN, VERB+NOUN).
4. Compute/store `freq_zipf` (approximate via `wordfreq`).
5. Save as `cards/draft_cards_<LEVEL>.jsonl` (one JSON per line).

## Selection & Cleaning

- Generate `collocations` with anchor preference (verbs, fixed preps).
- Mark `avoid_as_blank` for proper nouns, numbers, dates, and ambiguous tokens.
- Keep 1–3 level-appropriate example sentences per lemma.

## Quality Gates

- Sentence length bounds; remove proper nouns; dedupe near-duplicates.
- Collocations above min count; POS-consistent.

## Acceptance Criteria

- Produces ≥ 1k draft cards per level on SimpleWiki.
- ≥80% cards have at least one decent example and ≥2 collocations.
