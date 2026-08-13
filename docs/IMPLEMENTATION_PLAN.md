# Implementation Plan

## Phase 0 — Repository setup

Deliverables:

- TypeScript project.
- Zod config validation.
- `.env.example`.
- tests runnable from one command.
- source folders match architecture.

Acceptance:

```bash
npm install
npm test
npm run typecheck
```

## Phase 1 — Data + deterministic draft brain

### Tasks

1. Implement SportsLine XLSX importer.
2. Implement name normalization.
3. Load league/strategy config.
4. Create draft-state domain types.
5. Implement scoring components.
6. Implement shortlist generation.
7. Add append-only JSONL event log.
8. Build CLI command that ranks a fixture.
9. Add tests.

### Acceptance

```bash
npm run rank:fixture -- fixtures/pick-21.json
```

prints ranked candidates with component scores.

No browser/OpenAI dependency required.

## Phase 2 — CBS read-only adapter

### Tasks

1. Add Playwright persistent context.
2. User logs in manually.
3. Add `cbs:diagnose` command.
4. Use Playwright MCP/codegen to discover live selectors.
5. Implement `CBSReader` methods.
6. Add resync from draft results.
7. Run monitor mode.

### Acceptance

During a mock/live test, terminal accurately prints picks and current team on clock without performing actions.

## Phase 3 — OpenAI bounded decision layer

### Tasks

1. Add official OpenAI SDK.
2. Add Zod Structured Output schema.
3. Create compact decision prompt.
4. Enforce shortlist membership.
5. Add timeout and fallback.
6. Log latency/confidence.

### Acceptance

AI can reorder a fixture shortlist, but an injected out-of-set candidate is rejected.

## Phase 4 — Recommendation UI

MVP terminal UI first.

Show:

- pick/time,
- roster,
- top candidates,
- component scores,
- AI decision,
- warnings,
- current execution mode.

Optional local web dashboard later.

## Phase 5 — CBS executor in confirm mode

### Tasks

1. Create separate executor adapter.
2. Add final fresh-state checks.
3. Implement target search/match.
4. Implement one-pick idempotency.
5. Verify draft result.
6. Disable on verification error.

### Acceptance

At least 10 successful mock selections with zero wrong-player events.

## Phase 6 — Queue fallback

If CBS queue DOM is stable:

- maintain top 5–10 candidates in queue,
- reorder after every league pick,
- do not fill queue with invalid roster positions,
- verify order.

This is a resilience feature, not required for first useful release.

## Phase 7 — Full autopilot

Only after readiness checklist.

Autopilot should use the same executor as confirm mode; only the confirmation boundary changes.

Never create a second “fast” code path that skips validation.

## Phase 8 — Keeper lock update

After keepers lock:

1. Import the official 32 keeper list.
2. Mark them unavailable before draft start.
3. Re-run player identity reconciliation.
4. Confirm Jeanty and Pickens belong to user's roster.
5. Confirm Walker belongs to the trade partner if kept/rostered as expected.
6. Recompute rankings.
7. Export a final human-readable backup queue.

## Phase 9 — Calibration

Run mock drafts and inspect outcomes.

Tune weights based on:

- obviously early QB/TE picks,
- failure to react to positional runs,
- excessive need-based reaching,
- falling value that should have been taken,
- how often top candidate survives to user's next pick.

Do not tune based on one anecdotal pick; use replay logs.
