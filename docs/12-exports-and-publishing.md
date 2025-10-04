# Exports & Publishing

## Goals

- Share curated sessions easily; keep deployment simple.

## Exports

- CSV subset export from Pack Inspector (client-side download).
- Printable HTML: show word-bank and selected hints when enabled; answer key togglable. Student link mirrors the same configuration deterministically, no PDF dependency required.

## Static Publishing

- `npm run build` → `dist/`; include `packs/` next to assets.
- Host on any static provider (Vercel/Netlify/GitHub Pages/S3).

## Acceptance Criteria

- Teacher can export a curated set and share a static link in <2 minutes.
- Printed view renders well on A4/Letter without extra styling tweaks.
