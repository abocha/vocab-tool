# CLI Script Reference

This repo ships a small set of Node.js scripts under `scripts/` and npm wrappers in
`package.json`. They share a few option conventions (especially the SFW filters). Use this
cheat sheet when you need to run the tools directly or add automation around them.

## Common Safety / Filtering Flags

All content-processing CLIs (`corpus-to-cards`, `cards-to-packs`, `packs-validate`) accept the
same guardrail options:

- `--sfwLevel <off|default|strict>`
  - `off`: disable safety filters entirely.
  - `default`: enable the default guard set (same as passing no flag).
  - `strict`: enable the school-safe profile (drops sexual vocabulary unless allow-listed).
  - Invalid values fall back to `default`.
  - **Default:** `strict` (omit the flag to stay in strict mode).
- `--dropProperNouns <on|off>`
  - Default `on`. When true, filters out proper nouns using the contextual heuristics and
    allow-lists specified below.
- `--acronymMinLen <number>`
  - Minimum length for acronyms that survive filtering (default `3`). Any shorter acronym is
    removed unless allow-listed.
- `--blockList <path>` / `--allowList <path>`
  - Override the default block/allow lists. Paths are resolved relative to the repo unless
    absolute.
- `--properList <path>` / `--nationalities <path>`
  - Supply custom context lists to help the proper-noun detector.
- `--sfwAllow <path>`
  - Extra allow-list for terms that should survive strict mode (handy for anatomy lessons, etc.).

## `corpus-to-cards.js`

Derives draft cards (examples, collocations, frequency metadata) from the SimpleWiki corpus.

Key options:

- `--level <A1|A2|B1|B2>` (default `A2`).
- `--tokens <path>` (optional gz/csv token dump for POS/lemma hints).
- `--sentences <path>` (defaults to `.codex-local/corpus/simplewiki/clean/sentences_<level>.txt`).
- `--freq <path>` and `--bigrams <path>` (frequency statistics; defaults live under
  `.codex-local/corpus/simplewiki/data/`).
- `--out <path>` (default `cards/draft_cards_<LEVEL>.jsonl`).
- `--limit <number>` cap emitted cards.
- `--maxExamples <number>` per card (default `3`).
- `--minColloc <number>` and `--maxColloc <number>` (defaults `5` / `8`).
- `--showSamples` prints representative cards to stdout.

Use the npm wrappers:

```bash
npm run cards:draft                 # default (strict) guard profile
npm run cards:draft -- --level B1   # override the level (outputs cards/draft_cards_B1.jsonl by default)
```

## `cards-to-packs.js`

Builds deterministic `gapfill.csv`, `matching.csv`, and `mcq.csv` files from existing cards.

Key options:

- `--cards <path>` (default `cards/draft_cards_<LEVEL>.jsonl`).
- `--level <A1|A2|B1|B2>` (default `A2`).
- `--outDir <path>` (default `public/packs/<level>`).
- `--limitGapfill`, `--limitMatching`, `--limitMcq`, `--limitScramble` (per-file row caps).
- `--preset <preset-id>` apply builder hints from `presets/library.json`.
- `--sfwLevel`, `--dropProperNouns`, `--acronymMinLen`, `--blockList`, `--allowList`,
  `--properList`, `--nationalities`, `--sfwAllow` (see above).

Typical invocations:

```bash
npm run packs:from-cards                       # default (strict) guards, level A2
npm run packs:from-cards -- --level B1         # override level/output dir (expects cards/draft_cards_B1.jsonl)
npm run packs:from-cards -- --preset a2-collocations
```

Pass extra flags after `--` when using npm scripts so they reach the underlying Node CLI.

> Summary JSON now includes a `bankTelemetry` object with totals by level and preset (tag mix,
> size buckets, relaxed counts) to help spot thin banks before validation.

### Notes on `--preset`

When you pass `--preset <id>` the builder loads the matching entry from
`presets/library.json`. Presets may override gap-fill mode, bank size, function-word allowances,
and inject extra collocation families. The preset id is recorded in `bank_meta` so downstream tools
can track which policy produced each bank.

## `packs-validate.js`

Validates generated packs (any level) and surfaces telemetry.

- `--dir <path>` directory containing the CSVs (default `public/packs/A2`).
- `--level <A1|A2|B1|B2>` convenience flag that sets `--dir public/packs/<LEVEL>` automatically.
- `--pack <gapfill|matching|mcq|scramble>` repeatable; if omitted the validator inspects all
  detected packs.
- `--type <auto|gapfill|matching|mcq|scramble>` force the CSV schema when file names are
  ambiguous.
- `--strict` exit with a non-zero status when any guard or validator drops occur.
- Safety flags: `--sfwLevel`, `--dropProperNouns`, `--acronymMinLen`, `--blockList`,
  `--allowList`, `--sfwAllow`.
- Matching rows containing multiple pipe-separated values are rejected as `invalid_format` and
  surfaced in the CLI summary.

Examples:

```bash
npm run packs:validate                              # default guard profile
npm run packs:validate -- --dir public/packs/B1     # validate another level
npm run packs:validate:strict                       # strict guards + strict exit
```

## `prepare-packs.js`

Utility that copies existing CSV packs into the repo (optionally sampling rows for quick dev
passes).

- `--source <path>` source directory (default `../.codex-local/corpus/simplewiki/packs`).
- `--dest <path>` destination directory (default `./public/packs`).
- `--sample <rows>` keep only the first _n_ rows per CSV.

## `convert-matching-set-to-pairs.js`

One-off converter that rewrites legacy “set-per-row” matching CSVs into the canonical
“pair-per-row” format.

- `--in <path>` legacy CSV (required).
- `--out <path>` destination for the converted file (required).

The tool preserves optional metadata columns (`level`, `source`, `license`, `count`). Rows with
pipe-delimited values are expanded into multiple pair rows.

## Passing Extra Flags via npm Scripts

When using the npm wrappers, append `--` before any additional CLI arguments so npm forwards them
unchanged:

```bash
npm run packs:from-cards -- --level B2 --preset b1-grammar-third-person
npm run packs:validate -- --dir public/packs/B1 --sfwLevel strict --strict
```

This pattern works for all scripts listed in `npm run`.
