# CSV Pack Specification (MVP)

**Directory:** `public/packs/<LEVEL>/` (A1, A2, B1, B2)

## Common Rules

- CSVs include headers; UTF-8; one item per row.
- Unknown/extra columns must be ignored gracefully.
- Attribution: include `source`, `license` in each row where applicable.

## Files & Columns

### 1) Gap-fill

- **File:** `gapfill.csv`
- **Columns:**  
  `level, type(gapfill), prompt, answer, source, license`
- **Notes:** `prompt` contains a single blank `_____`.

### 2) Matching

- **File:** `matching.csv`
- **Canonical shape:** one pair per row.  
  Columns: `level, type(matching), left, right, source, license, count`.
- **Notes:**
  - `left` is the prompt/collocate; `right` is the target lemma. Each row represents exactly one pair.
  - `count` is optional metadata (often left blank). The frontend derives its own grouping, so this value is not used for set sizing.
  - The app still detects legacy set-per-row rows (`a|b|c`) for backward compatibility. They are split into individual pairs, a warning banner is shown, and `packs-validate` reports them under `deprecated_set_per_row`. Prefer converting legacy files with `npm run packs:convert:matching` (see helper script) before publishing.

### 3) MCQ

- **File:** `mcq.csv`
- **Columns:**  
  `type(mcq), prompt, options, answer, source, license`
- **Notes:** `options` pipe-delimited, 4+ entries, includes `answer`.

### 4) Scramble

- **File:** `scramble.csv`
- **Columns:**  
  `level, type(scramble), prompt, answer, source, license`
- **Notes:** `prompt` is the shuffled word sequence; `answer` is the original sentence.

## Versioning

- Add optional `pack_version` and `generator` in a `meta.json` alongside CSVs.

## Acceptance Criteria

- The app renders correct counts for each type.
- Missing files lead to empty, not broken, UI states.
