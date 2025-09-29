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
- **Two Supported Shapes** (app must support **both**):
  - **Set-per-row (CURRENT APP DEFAULT):**  
    `level, type(matching), left, right, source, license, count`  
    where `left` is `a|b|c` and `right` is `x|y|z` (order aligned by index).
  - **Pair-per-row (PIPELINE-FRIENDLY):**  
    `level, type(matching), left, right, source, license, count`  
    one pair per row; multiple rows form a set in UI.
- **Notes:** When both forms appear, treat pair-per-row grouped by `setId` if present, else by chunking.

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
