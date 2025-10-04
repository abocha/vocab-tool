# Cards Data Model (Draft)

**Purpose:** Make “cards” the single source of truth that can power exercises from corpus or teacher inputs.

## Card (draft JSONL schema)

{ "lemma": "maintain",
"pos": "VERB",
"freq_zipf": 4.3,
"examples": ["They maintain the equipment regularly."],
"collocations": [
  { "anchor": "maintain", "partner": "equipment", "score": 5.1 },
  { "anchor": "maintain", "partner": "relationship", "score": 4.7 }
],
"distractors": [],
"source": "simplewiki",
"license": "CC BY-SA"
}

### Additional Fields (optional, backward-compatible)

- `collocations`: array of {anchor: string, partner: string, score: number} (derive POS -> list maps at read time if needed)
- `freq_zipf`: number (existing, used for level gating)
- `flags`: { avoid_as_blank?: boolean, polysemy?: boolean }

## Principles

- Minimal viable card fields now; expandable later (senses, defs, media).
- Keep provenance and license.
- Avoid LLM dependence; enrich later.

## Acceptance Criteria

- Cards can be generated from corpus heuristics (no LLM).
- Exercise builders can consume cards to emit the same CSV shapes used by the MVP app.
