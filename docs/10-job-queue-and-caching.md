# Job Queue & Caching (Later Phase)

## Goal

Run batch jobs (enrichments, media builds) predictably and cheaply.

## Job Types

- CreateCardsFromList, ExtractTargetsFromText, EnrichCards (optional LLM), BuildExercises, BuildMedia (TTS).

## States

`queued → running → needs_review | failed | done`

## Caching

- Key = `sha256(model_id + prompt_template_version + seed_payload_json)`.
- If key exists → reuse cached result.
- Cache keys include model+template+payload SHA for any optional LLM step (e.g., rating distractor plausibility). Falls back to non-LLM path if cache miss and budgets disabled.

## Execution Model

- Local JSON queue + worker process (Node).
- Concurrency caps (2–3 jobs).
- Structured logs; retries with backoff.

## Acceptance Criteria

- Jobs are idempotent and resumable.
- Cached requests skip LLM/API costs reliably.
