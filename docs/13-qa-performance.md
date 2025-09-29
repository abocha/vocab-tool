# QA & Performance

## Browser Compatibility

- Latest Chrome/Edge/Safari/Firefox.
- Basic mobile support (layout stacks vertically; inputs not clipped).

## Performance Considerations

- CSV parsing in chunks; avoid blocking main thread.
- Sampling for very large packs; default N items with Shuffle toggle.
- Minimize re-renders; memoize parsed data per (level,type).

## Telemetry (Optional)

- Local-only counters: time on task, avg score, abandon rate.
- No network beacons by default.

## Acceptance Criteria

- Perceived load for 1k-row CSV < 2s on modern laptop.
- No dropped keypresses; Next/Check feels instant.
