# Media / TTS Plan (Optional)

## Goal

Add audio for headwords and 1 example per card, fully offline-capable.

## Approach

- Use eSpeak NG (or similar) to generate `audio/<lemma>.mp3`.
- Store links in cards (relative paths).
- In UI, show a small speaker icon near prompts/options where relevant.
- Expose optional per-sentence TTS clip for gap-fill as a "hint" (icon toggle). Bundled locally; small files; no blocking.

## Constraints

- Keep voices consistent; avoid uncanny valley.
- Cache/bundle only small clips.

## Acceptance Criteria

- Batch TTS completes for 1k lemmas in reasonable time.
- UI plays audio without blocking interaction.
