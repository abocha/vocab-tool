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
