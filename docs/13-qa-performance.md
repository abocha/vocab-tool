# QA & Performance

## Browser Compatibility

- Latest Chrome/Edge/Safari/Firefox.
- Basic mobile support (layout stacks vertically; inputs not clipped).

## Performance Considerations

- CSV parsing in chunks; avoid blocking main thread.
- Sampling for very large packs; default N items with Shuffle toggle.
- Minimize re-renders; memoize parsed data per (level,type).

## Gap-Fill Targets

- Gap-fill latency: selecting gaps + building banks must stay sub-50ms for 1k rows on mid-range laptops (memoize collocations & Zipf checks).
- Keystroke budget: Inspector inputs never block; filters debounce (≤200ms).
- Success-rate tracking: store local aggregates (anonymized) for teacher feedback; opt-in only.

## Telemetry (Optional)

- Local-only counters: time on task, avg score, abandon rate.
- No network beacons by default.

## Acceptance Criteria

- Perceived load for 1k-row CSV < 2s on modern laptop.
- No dropped keypresses; Next/Check feels instant.

## Phase 2 QA Checklist

1. **Build packs with presets**: run `npm run packs:from-cards -- --level A2 --preset a2-collocations` and confirm the CLI summary includes `bankTelemetry` with per-level/per-preset totals.
2. **Validate packs**: execute `npm run packs:validate:strict` and ensure `invalidFormatRows` is `0`, tag mix looks sane, and relaxed usage stays below agreed thresholds.
3. **Inspector spot-check**: open the Pack Inspector, filter for “Only banks with relaxed distractors,” and manually review a handful of items per level.
4. **Telemetry snapshot**: archive the JSON summaries (cards-to-packs + packs-validate) with each release so regressions can be diffed quickly.
