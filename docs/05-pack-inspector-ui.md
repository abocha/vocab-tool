# Pack Inspector UI (Teacher Controls)

## Goal

Provide a lightweight review layer inside the app to curate packs for a session.

## Scope (MVP)

- List view for current (level, type).
- Controls: Shuffle, Max Items, Hide/Keep item toggles.
- Quick filters: length range, contains word, regex (optional).
- Export: save filtered subset to CSV (client-side download).

## Non-Goals

- Editing the underlying CSV on disk.
- Full text editing of items (postpone).

## Acceptance Criteria

- Teacher can curate a 20–50 item subset in <5 minutes.
- Exported CSV opens in Excel/Sheets and can replace the pack for a session.
