# Corpus Pipeline Overview (WSL Ubuntu 24.04)

## Inputs

- Simple English Wikipedia dump → WikiExtractor `--json`.
- Scripts in `~/scripts`: `flatten_sentences.py`, `annotate.py`, `freq.py`, `ngrams.py`, `level_filter.py`, `make_*`.

## Outputs (canonical)

- `~/corpus/simplewiki/clean/sentences.txt` (+ level subsets).
- `~/corpus/simplewiki/data/tokens.csv[.gz]`, `freq_lemmas.csv`, `bigrams.csv`, `trigrams.csv`.
- `~/corpus/simplewiki/packs/<LEVEL>/{gapfill.csv,matching.csv,mcq.csv,scramble.csv}`.

### Collocation Signals for Builders

- Compute bigram stats (e.g., PMI, LLR) and store top collocation anchors at card-time.
- Expose anchors (verbs/prepositions) to the Gap Strategy Engine for predictable blanks.

### Blank Safety Gates

- Exclude proper nouns, numbers/dates, ultra-rare tokens by default.
- Allow stopwords only when a grammar preset explicitly targets them (articles, prepositions, auxiliaries).

## Guarantees

- Streaming + progress bars (tqdm).
- Heuristic gates (Zipf thresholds, length, alpha tokens).
- Attribution: every pack row carries `source`, `license`.

## Acceptance Criteria

- Each stage completes on a 200MB sentences file without running out of memory.
- Packs for at least one level (A2) contain ≥ 500 valid items total.
