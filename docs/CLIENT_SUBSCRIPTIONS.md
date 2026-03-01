# Client Subscriptions

Recommended baseline set for the playable client:

- `worldState`
- `worldConfig`
- `player`
- `obstacle`
- `junk`
- `generator`
- `line`
- `rootNode`
- `rootRelocation`
- `eventLog`

Optimized screen-focused set:

- World/HUD: `worldState`, `worldConfig`, `eventLog`
- Movement/map: `player`, `obstacle`, `junk`
- Network/gameplay: `generator`, `line`, `rootNode`, `rootRelocation`

Client rendering stability:

- Sort table rows by deterministic keys before rendering (`id`, `playerId`, `line.id`).
- Keep local view-model keyed by table primary key to avoid UI jitter on update batches.

Interpolation fields:

- Use `worldState.currentTick` and `worldState.tickRate` as timeline source.
- Use `player.lastUpdatedTick` with `player.posX/posY` for client interpolation between 20 Hz server ticks.
