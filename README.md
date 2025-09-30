# ESL Vocab Tool — MVP

A lightweight, browser-based practice tool for English learners. Exercises are sourced from pre-built CSV packs generated from Simple English Wikipedia content (CC BY-SA) and delivered entirely on the client via React + Vite.

## Prerequisites

- Node.js 20 or 22
- npm (ships with Node). PNPM/Yarn also work if you prefer, but commands below use npm.

## Getting Started

Install dependencies and start the Vite dev server:

```bash
npm install
npm run dev
```

The dev server defaults to http://localhost:5173 and will hot-reload on file changes.

## CSV Packs

Exercise CSVs are loaded from `public/packs/<LEVEL>/` and must already exist before running the app. This repository ships with small sample packs for levels A1–B2 so the UI works immediately.

For real datasets, copy the generated CSVs from your corpus pipeline into the matching directories:

```
public/packs/
  A1/
    gapfill.csv
    matching.csv
    mcq.csv
    scramble.csv
  A2/
    …
  B1/
    …
  B2/
    …
```

Each CSV must include the headers defined by the corpus pipeline (see `/docs/03-csv-pack-spec.md` and `/src/lib/csv.ts`). Missing files are skipped gracefully and surfaced as warnings in the UI banner.

### Matching data shapes

The Matching exercise now accepts both CSV variants and normalises them into a single in-memory structure:

- **Set-per-row** — single row with pipe-delimited `left`/`right` lists. The loader honours the declared `count` column and surfaces mismatches.
- **Pair-per-row** — one pair per row; rows are grouped by `setId` when present, otherwise chunked deterministically so the UI still renders sets.

When both shapes appear in the same file, the inspector banner calls it out so you can review the grouping. Learners still receive the same scoring UX: set score, overall % score, and an explicit note if the `Pairs per Set` limit sampled a subset of the available pairs.

- The optional `count` column is treated as frequency metadata (not a set size). Actual set size is derived from the parsed pairs; the “Pairs per Set” control caps how many are shown.
- Diagnostics are summarised (counts by issue). Toggle “Show info notices” / “Show detailed warnings” in the inspector to reveal optional metadata notes and up to five representative sample rows per issue type.
- Sampling is deterministic per dataset + set identifier, so a given `Pairs per Set` limit pulls the same subset until the data changes.

### Copying or Sampling Packs

Use the included helper to copy CSVs from the corpus workspace and optionally keep only the first N rows for fast iteration:

```bash
npm run prepare:packs -- --source "~/corpus/simplewiki/packs" --sample 100
```

Flags:

- `--source` (optional): source directory. Defaults to `~/corpus/simplewiki/packs`.
- `--dest` (optional): destination directory. Defaults to `public/packs` inside the project.
- `--sample` (optional): keep only the first N rows (after the header) of each CSV. Omit the flag to copy the full files.

## Phase 2: Cards & Builders

The Phase 2 pipeline turns the SimpleWiki corpus into reusable cards and then emits exercise CSVs that match the existing UI contracts. All steps are deterministic for the same inputs so regenerated packs remain diff-friendly.

```bash
# 1) Derive draft cards (examples + collocations) for a level
npm run cards:draft -- --level A2 --limit 5000 --showSamples

# 2) Build CSV packs from those cards
npm run packs:from-cards -- --level A2 --limitGapfill 1200 --limitMatching 800 --limitMcq 1000

# 3) Validate the outputs before shipping
npm run packs:validate -- --dir public/packs/A2 --type auto
```

- `cards/draft_cards.jsonl` stores one JSON object per line with the schema described in `/docs/06-cards-data-model.md`.
- The pack builders keep the same column headers and shapes defined in `/docs/03-csv-pack-spec.md`, and every CSV export is written with a UTF-8 BOM so Excel opens them without mangling characters.
- The validator CLI summarises totals, drops, and heuristic warnings per file; it exits non-zero only when a file is unreadable or missing required headers.
- Filtering heuristics strip named entities, unsafe phrases, short acronyms, formula stubs, and (optionally) sexual vocabulary. Tweak the lists under `filter-lists/` or toggle behaviour with `--sfwLevel`, `--sfwAllow`, `--dropProperNouns`, `--acronymMinLen`, and related flags.

When iterating on the corpus heuristics, avoid renaming columns—the Pack Inspector and the React app expect the stable schemas shipped in Phase 1.

## Pack Inspector (teacher workflow)

Open the “Pack Inspector” panel below the exercise view to curate the currently loaded level + exercise:

- Filter by substring and length range, hide/restore individual items, and see live counts (parsed → filtered → displayed). Filters + hidden IDs persist per `(level, type)` in `localStorage` for quick revisits.
- Toggle Shuffle, Max Items, and (for matching packs) the `Pairs per Set` limit without leaving the inspector. These settings drive the learner view immediately and also persist.
- Export the curated subset to CSV directly in the browser. Files are named like `matching.curated.A2.20250304-1030.csv`, include a UTF-8 BOM for Excel compatibility, and preserve the original schema for each exercise type (matching exports use the set-per-row form).
- Review diagnostics in-line: header mistakes, missing levels, mixed matching shapes, and other parser warnings are summarised in the inspector as well as in the banner above the learner card. Enable “Show info notices” and “Show detailed warnings” to reveal optional metadata notes and up to five concrete examples per issue type.

The top-of-page banner also surfaces parse warnings and errors (missing columns, skipped rows, empty files) so malformed packs never crash the app—the UI simply falls back to a friendly empty state.

## Available Scripts

- `npm run dev` — start the dev server.
- `npm run build` — type-check and produce a static build in `dist/`.
- `npm run preview` — preview the production build locally.
- `npm run prepare:packs` — copy/sample CSV packs (see above).
- `npm run cards:draft` — derive draft cards from the SimpleWiki corpus (examples, collocations, frequency metadata).
- `npm run cards:filter` — regenerate cards with the default safety filters.
- `npm run cards:filter:strict` — regenerate cards with the school-safe profile.
- `npm run packs:from-cards` — build deterministic gap-fill, matching, and MCQ CSVs from the draft cards.
- `npm run packs:from-cards:safe` — build packs with the default guards.
- `npm run packs:from-cards:strict` — build packs with the school-safe profile.
- `npm run packs:validate` — run the pack validator summary over one or more levels.
- `npm run packs:validate:strict` — validator in school-safe mode with strict exit on guard hits.

### SFW Profiles

All build/validate CLIs accept `--sfwLevel` (or the legacy `--sfw` boolean) to control the guardrails:

```bash
# School-safe (sexual vocabulary removed unless allow-listed)
node scripts/corpus-to-cards.js --level A2 --tokens ./.codex-local/corpus/simplewiki/data/tokens.csv.gz \
  --out cards/draft_cards.jsonl --sfwLevel strict --dropProperNouns on

node scripts/cards-to-packs.js --cards cards/draft_cards.jsonl --level A2 \
  --outDir public/packs/A2 --sfwLevel strict

node scripts/packs-validate.js --dir public/packs/A2 --type auto --sfwLevel strict --strict

# Mature / default filtering
node scripts/cards-to-packs.js --cards cards/draft_cards.jsonl --level A2 --sfwLevel default

# Disable SFW filtering entirely
node scripts/corpus-to-cards.js --level A2 --sfwLevel off

# Allow-list specific terms when running in strict mode
node scripts/packs-validate.js --dir public/packs/A2 --sfwLevel strict --sfwAllow ./filter-lists/sfw-allow.txt
```

Lists live under `filter-lists/` and can be customised per team/project. The validator reports guard hits under the `filters` section; combine `--sfwLevel strict` with `--strict` to fail the build when any guarded terms remain.

## Deploying

The app is a static site. Any static host (Vercel, Netlify, GitHub Pages, S3, etc.) works:

```bash
npm run build
npm run preview   # optional sanity check
```

Upload the contents of the `dist/` directory to your hosting provider. Ensure the `packs/` folder (with CSVs) sits alongside the static assets so the browser can download them. Curated CSVs exported via the Pack Inspector drop-in seamlessly replace the originals.

## Data Storage & Privacy

Progress and user settings are stored locally in `localStorage` under the `esl-vocab-mvp/*` namespace. There is no backend and no data leaves the browser.

## Attribution & Licensing

Content is derived from Simple English Wikipedia and is licensed under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). When distributing the site, keep the attribution footer visible and include this notice (or similar) in your documentation.

## Troubleshooting

- **CSV not loading**: check the browser console for warnings. Missing or malformed headers are logged there.
- **Changed packs not visible**: the browser may cache CSVs aggressively during dev. Hard-refresh or bump the file name while iterating.
- **Local storage issues**: use the Reset Progress button in the UI or clear the `localStorage` entries beginning with `esl-vocab-mvp`.

Happy studying!
