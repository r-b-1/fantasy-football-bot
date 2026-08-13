# Test Plan

## 1. Unit tests

### SportsLine importer

Verify:

- reads all six sheets,
- skips blank rating rows,
- parses numbers,
- trims player names,
- handles DST leading whitespace,
- preserves bye week,
- produces no unexpected duplicate keys.

### Scoring

Tests should prove:

- falling below ADP increases value score,
- earlier-than-ADP decreases value score,
- WR/RB roster need changes as starters fill,
- K/DST are penalized early,
- next-pick risk changes between pick 30->35 and 35->67,
- hard roster limits exclude candidates,
- deterministic ordering is stable.

### AI validator

- accepts a valid candidate choice,
- rejects out-of-shortlist candidate ID,
- rejects duplicate alternatives,
- falls back on timeout/error,
- falls back below confidence threshold.

## 2. Fixture-driven draft replay

Create JSON fixtures for a simulated 16-team draft.

Replay:

- keepers removed,
- picks 1–2,
- user decision at #3,
- picks 4–20,
- user decision at #21,
- etc.

The draft engine should generate repeatable recommendations.

## 3. CBS reader tests

Once selectors are discovered, save sanitized HTML/accessibility fixtures if practical.

Test extraction of:

- current pick,
- user-turn status,
- available player row,
- draft result rows,
- user roster.

Do not commit personal cookies/session data.

## 4. Live read-only rehearsal

Before draft day:

- enter a CBS mock draft or available draft-room rehearsal,
- run in monitor mode,
- compare every observed selection to CBS results,
- verify no false user-turn detection,
- exercise page reload/reconnect.

Target: zero missed or invented picks.

## 5. Confirm-mode rehearsal

In a mock draft:

- allow the system to recommend,
- operator confirms,
- verify executor picks exact player,
- test 10+ picks across different table states/search filters.

## 6. Failure injection

Test:

- player selected by someone else between ranking and final validation,
- selector renamed,
- countdown under threshold,
- OpenAI timeout,
- OpenAI malformed result,
- CBS page reload,
- duplicate execution attempt,
- wrong team on clock,
- target identity collision,
- verification result delayed.

Expected behavior should be fail-closed.

## 7. Autopilot readiness checklist

Do not enable full autopilot until:

- [ ] 32 keepers are imported and verified.
- [ ] all current user draft picks are verified from CBS.
- [ ] SportsLine import passes tests.
- [ ] at least one complete mock draft is monitored without state mismatch.
- [ ] confirm mode completes at least 10 successful mock selections.
- [ ] duplicate-submit test passes.
- [ ] selector-failure test disables execution.
- [ ] OpenAI outage fallback works.
- [ ] user has reviewed live settings and platform/league rules.
- [ ] human backup draft board is open/available.
