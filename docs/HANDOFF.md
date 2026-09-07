# Handoff: Need-Aware Projection Pass

> Branch: `feature/predict-next-picks` (last commit `1fd1ef3`)
> PR: https://github.com/r-b-1/fantasy-football-bot/pull/1
> Status: 89/89 tests green, typecheck clean, end-to-end smoke verified live with MiniMax M3 free via OpenRouter.

## What's working

1. **Projection pass** that runs on every non-user poll, deterministic by default, OpenAI/M3 rerank when a key is set. The model can never invent a player (Zod-validated membership).
2. **Rich 16-team fake draft room** with autopicks for non-user teams, pause on user turns, league-wide keepers panel.
3. **Per-team need scoring** from `docs/roster-grid (1).csv` (operator-provided preseason roster grid). The bot walks picks forward, identifies the team on the clock via slot math, scores each available player by `(need × ADP proximity × rating)`, and emits an 8-pick projection.
4. **OpenRouter integration** via raw `fetch` (no `openai` SDK). `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL` env vars.
5. **`cbs:fixture-projection` CLI** that runs the rich room + projection loop without ever landing on CBS.

## What you can do right now

```bash
npm test                                       # 89 tests
npm run typecheck                              # clean
npm run decide:fixture -- fixtures/pick-21.json   # real AI pick from MiniMax M3
npm run predict:fixture -- fixtures/pick-21.json  # real AI projection
npx tsx src/index.ts cbs-fixture-projection --headless --no-pause-on-user   # live rich room
```

The rich fake room banner is RED and reads "LOCAL FAKE DRAFT ROOM — RICH — 16 TEAMS — NOT CBS — NO LIVE DRAFT ACCESS". It never contacts CBS. The autopicker for non-user teams runs against `fixtures/fixture-16team-rich.json`'s `autopickPool`. Keepers are marked `_skip: true` in the pool and never autopicked. The "League-wide keepers" panel under draft results shows every team's keeper so the operator can confirm the dataset.

## Open work to continue (priority order)

### 1. Trades / swapped picks (highest-value, user-flagged)

**Problem:** `league.knownOverallPicks` only contains the user's own pick numbers. For other teams, `weightedNextPickByTeam` computes "the next pick at slot N" from `currentOverallPick` + snake math. This is wrong if teams have traded picks.

**Where:** `src/engine/teamNeed.ts:73-111` (the function), and the snake-slot math in `src/engine/predict.ts:112-127`.

**What to build:**
- A new config field on `LeagueConfig` (e.g. `leaguePicks: Array<{ teamName: string; picks: number[] }>` or a map). Schema goes in `src/config/schema.ts`. The `inferUserTeamFromYouAreUp` is optional so make this `leaguePicksArePartial: boolean` and required-validate it.
- Replace `teamBySlot` (which assumes `grid.teams[i] = slot i+1`) with a real lookup: pick → team that owns it.
- Once trades are modeled, `teamByPick` in `needAwareProjection` becomes exact, not a slot guess.

**Why this matters:** until trades are modeled, every projection is off by at least one pick number for any team involved in a trade. For this user the trade is documented in `league.current.json.completedTrades` (Kenneth Walker III + pick 62 for pick 21) but only the user's side is captured.

### 2. Live CBS keepers

**Problem:** the projection uses fixture `keepers` only when running `cbs:fixture-projection`. The live `cbs:monitor` path has no way to know other teams' keepers. The user's own keepers are in `league.keepers` but other teams' aren't.

**Where:** `src/cbs/monitor.ts:108-115` (the predictNextPicks call passes `keepers: undefined`).

**What to build:**
- Add an optional `leagueKeepersPath` config field pointing at a JSON/CSV of `{fantasyTeam, name, position}` for all 16 teams.
- Or: scrape them from the CBS draft room on first poll (if CBS renders a "kept players" panel; check selectors.live.json once diagnose has been run on a real room).
- Pass to `predictNextPicks.keepers` in monitor.ts. Same code path will work; the deterministic and AI projections will both improve.

### 3. Live CBS recommend mode also shows projection

**Problem:** projection currently only fires in `cbs:fixture-projection` and `cbs:monitor` (with `--no-projection` opt-out). The `cbs:recommend` mode (the user's main live path) is in `src/cbs/recommend.ts` from a stashed refactor and doesn't have the projection call wired in.

**Where:** `src/cbs/recommend.ts:191-301` (the `runRecommendPollLoop`). Add a call to `predictNextPicks` after each non-user poll, gated by the same `showProjection` flag.

**Note:** the stashed refactor that produced this `recommend.ts` was already integrated into this branch earlier (commit `2ff10c5`). So the file exists, just needs the projection layer glued in. Compare to `src/cbs/monitor.ts:96-130` for the exact pattern.

### 4. Confirm-mode end-to-end with the rich room

**Problem:** `cbs-fixture-confirm` uses the *old* `fixture-draft-room.html` (pre-recorded picks, picks-35.json), not the rich room. So the operator can't practice the full "bot recommends, human confirms, bot clicks confirm" loop against the rich room.

**Where:** `src/cbs/fixtureConfirm.ts:33-50` builds the URL. Add a `useRichRoom` flag and switch the URL.

**What to build:**
- Add `--rich` flag to `cbs:fixture-confirm`
- When set, point at `server.richUrl` instead of `server.url`
- The rich room already has the `__fixtureDraft`/`__fixtureConfirm` window APIs, so the existing executor code should work unchanged.

### 5. Per-team K/DST need penalty

**Current state:** K and DST gets a flat 0.1× penalty when `pick < 130`. Working but coarse. The penalty should also account for `teamCounts.get(teamName)[K]` — if the team has 0 K filled, the K penalty at pick 22 is the right call; if they have 0.5 K "filled" by their grid roster, the penalty should be less.

**Where:** `src/engine/predict.ts:156` (`const earlyPenalty = isEarlyRound && (player.position === "K" || player.position === "DST") ? 0.1 : 1;`)

### 6. Persisted projection history

The `projection` event is appended to the event log but never summarized. A draft-night UI showing "we projected Ja'Marr Chase at #4, you got him at #4 — accuracy 100%" would be valuable for tuning.

**Where:** new file `src/state/projectionHistory.ts`, summary written when draft ends.

## How to keep working

- Branch is up to date on `origin/feature/predict-next-picks` (commit `1fd1ef3`).
- `npm install` is already done; no new deps needed for any of the above items.
- Tests live in `tests/`. New tests are expected to use vitest's existing patterns (see `tests/predict.test.ts`, `tests/roster-grid.test.ts`, `tests/cbs-fixture-rich.test.ts`).
- Run `npm test && npm run typecheck` before pushing.
- The `openai` SDK is intentionally gone. Do not re-add it. All AI traffic goes through `src/ai/openrouter.ts` (raw `fetch` to OpenRouter's `/chat/completions`).

## Live verification commands (run these first to confirm the setup is healthy)

```bash
npm test                                              # 89/89 should pass
npm run typecheck                                     # clean
npm run decide:fixture -- fixtures/pick-21.json       # expect an AI line at the bottom
npm run predict:fixture -- fixtures/pick-21.json      # expect 8 AI-projected picks
FIXTURE_UNTIL_PICK=10 npx tsx src/index.ts cbs-fixture-projection --headless --no-pause-on-user   # expect 2-3 PROJECTED NEXT N PICKS banners before stopping
```

If any of these fail, fix before continuing with new work. The typecheck and tests are the contract.
