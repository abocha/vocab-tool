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
- `bank_quality` recorded for inspection (`solid | soft | needs_review`).
- `bank_meta` (JSON) captures slot signature, chosen tags (`family|colloc|neighbor|curated|paradigm|relaxed`), bank size, and whether a relaxor fired.

> The curated pools live in `scripts/confusables.json` (`collocationFamilies`, `timePreps`, `placePreps`, `genericByPOS`, etc.).

**Determinism**
All choices derive from seed + row id + stable card data. Same inputs → same CSV.

### Smart Bank v1.1 (default policy)

- Candidate stages (deduped, in priority order):
  - **Family confusables** — curated `{anchor → distractors}` families when the sentence includes a known collocation head (e.g., `decision → make/take/reach`).
  - **Collocation confusables** — other lemmas that share the same partner in the card’s collocation index.
  - **Distribution neighbours** — lemmas that co-occur with the same partners in the corpus (acts as semantic near-miss coverage).
  - **Paradigm forms** — only when grammar mode or verb morphology is explicitly under test.
  - **Curated sets** — POS-specific synonym pools, light-verb lists, and domain-aware preposition groups (`timePreps`, `placePreps`, articles, auxiliaries).
  - **Relax fallback** — at most one deterministic filler when the bank is still short (same-lemma inflection in grammar mode or a high-frequency generic of the same POS). Relaxed banks are tagged.
- Hard filters:
  - POS/morph agreement with the inferred slot (`inferSlot` looks at surface form, neighbouring tokens, and card POS).
  - No stopwords in non-grammar modes; function words allowed only when the slot expects them.
  - No answer-lemma variants unless morphology is being probed; drop duplicates and prompt repeats.
  - Length sanity checks (≥3 unless the slot is a function-word bucket).
- Scoring & diversity:
  - Score = collocation strength + POS/morph confidence + frequency proximity + orthographic similarity − duplicate penalties.
  - Diversity selector keeps one lemma family per bank (unless grammar mode), limits repeats per curated group, and uses seeded tie-breaks for deterministic order.
  - Pack-level cooldown prevents the same distractor from appearing more than 20 times per generated pack.
- Bank quality classification:
  - `solid`: meets or exceeds the level’s minimum bank size and includes at least one high-plausibility source (family/colloc/neighbor).
  - `soft`: one short of the minimum or relied on the relax fallback.
  - `needs_review`: fewer than `minSize - 1` options after filters.

### New exercise type hooks (for later)

Pluggable builders follow the same pattern (pure function → CSV): Sorting/Grouping, Word-bank Cloze (multi-blank), Error-spotting.

## Acceptance Criteria

- Builders create packs the MVP app can load with zero code changes.
- Regenerating after card edits updates exercises idempotently.
