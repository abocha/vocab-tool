# Exports & Publishing

## Goals

- Share curated sessions easily; keep deployment simple.

## Exports

- CSV subset export from Pack Inspector (client-side download).
- Printable HTML view with answer key (no PDF dependency at MVP).

## Static Publishing

- `npm run build` → `dist/`; include `packs/` next to assets.
- Host on any static provider (Vercel/Netlify/GitHub Pages/S3).

## Acceptance Criteria

- Teacher can export a curated set and share a static link in <2 minutes.
- Printed view renders well on A4/Letter without extra styling tweaks.
