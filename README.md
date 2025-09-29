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

The Matching exercise now accepts both CSV variants:

- **Set-per-row** — single row with pipe-delimited `left`/`right` lists.
- **Pair-per-row** — one pair per row; rows are grouped by `setId`, otherwise by contiguous chunks using the `count` column.

Rows with inconsistent lengths or missing fields are skipped, and a concise warning is logged to the console/UI.

### Copying or Sampling Packs

Use the included helper to copy CSVs from the corpus workspace and optionally keep only the first N rows for fast iteration:

```bash
npm run prepare:packs -- --source "~/corpus/simplewiki/packs" --sample 100
```

Flags:

- `--source` (optional): source directory. Defaults to `~/corpus/simplewiki/packs`.
- `--dest` (optional): destination directory. Defaults to `public/packs` inside the project.
- `--sample` (optional): keep only the first N rows (after the header) of each CSV. Omit the flag to copy the full files.

## Pack Inspector (teacher workflow)

Open the “Pack Inspector” panel below the exercise view to curate the currently loaded level + exercise:

- Filter by substring and length range, hide/restore individual items, and see live counts (parsed → filtered → displayed).
- Toggle Shuffle/Max Items in context; the curated list immediately updates the learner view.
- Export the curated subset to CSV directly in the browser. The download preserves the original schema for each exercise type.

The banner above the exercise also surfaces parse warnings (missing columns, skipped rows) so teachers can catch malformed data quickly.

## Available Scripts

- `npm run dev` — start the dev server.
- `npm run build` — type-check and produce a static build in `dist/`.
- `npm run preview` — preview the production build locally.
- `npm run prepare:packs` — copy/sample CSV packs (see above).
- `npm run cards:draft` — **stub** CLI to adapt corpus CSVs into `cards/draft_cards_<level>.jsonl` (Phase 2 groundwork).
- `npm run packs:from-cards` — **stub** CLI to emit exercise CSVs from card JSONL files.

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
