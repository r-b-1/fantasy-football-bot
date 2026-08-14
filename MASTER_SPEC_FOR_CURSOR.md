# Pickens My Jeanty Draft Agent — Master Specification for Cursor

This is the single-file handoff. It mirrors the modular documentation in this repository. Cursor should treat the individual files as canonical when implementing.



---

## SOURCE FILE: `CURSOR_START_HERE.md`

# Cursor: Start Here

You are building a production-minded local fantasy-football draft assistant for one real CBS keeper league. The user cares more about **correctness and avoiding a bad pick** than about flashy autonomy.

## Immediate objective

Build a reliable MVP that can:

1. Parse `data/reference/cheatsheet_cbsppr12.xlsx`.
2. Load `config/league.current.json` and `config/strategy.current.json`.
3. Normalize player names and positions.
4. Given a draft-state JSON fixture, return a ranked shortlist with transparent component scores.
5. Persist draft events to an append-only local log.
6. Pass unit tests.

**Do not automate the live CBS page until the above works.**

## After Phase 1 passes

Use Playwright MCP or `npx playwright codegen` to inspect the user's real CBS draft room while the user is logged in manually. Build a read-only adapter first.

The CBS adapter must discover and validate selectors from the real page. Do not invent CSS selectors based on screenshots.

## Core engineering rule

The OpenAI model is a **bounded decision layer**, not the source of truth.

The deterministic engine should create approximately 5–10 eligible candidates. Send only those candidates plus structured league state to the model. The model must return a strict schema and select one of the provided candidate IDs. Reject any out-of-set answer.

## OpenAI implementation

Use the official `openai` TypeScript SDK and the Responses API. Prefer Structured Outputs with Zod (`openai.responses.parse` + `zodTextFormat`). Default model should be configurable; current recommended default is `gpt-5.6` with low reasoning effort for draft-clock latency.

If the OpenAI call fails, times out, returns an invalid decision, or has low confidence, use the deterministic top candidate and remain in `recommend`/`confirm` mode unless the operator has explicitly enabled full autopilot.

## Browser implementation

Use Playwright with a visible persistent browser profile. The user should log in manually. Do not accept CBS credentials as command-line arguments, source code, config files, or environment variables.

Use resilient locators (`getByRole`, `getByText`, labels/test ids when available) and web-first assertions. Create a dedicated CBS page-object/adapter so UI changes are isolated.

## Definition of done for a live pick

A pick is complete only when all of these are true:

1. The local state says it is the user's turn.
2. The live CBS page independently says it is the user's turn.
3. The candidate is visible and available.
4. Name/team/position identity is matched.
5. The executor performs exactly one selection action.
6. The CBS draft results show that candidate assigned to the user's team at the expected overall pick.
7. The overall pick advances.
8. The event is appended to the local event log.

Any failed check => stop execution and alert the user.

## Read the docs before coding further

- `docs/PRODUCT_REQUIREMENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/DRAFT_ENGINE.md`
- `docs/CBS_INTEGRATION.md`
- `docs/AI_DECISION_LAYER.md`
- `docs/SAFETY_RELIABILITY.md`
- `docs/TEST_PLAN.md`
- `docs/IMPLEMENTATION_PLAN.md`


---

## SOURCE FILE: `docs/PRODUCT_REQUIREMENTS.md`

# Product Requirements Document

## 1. Product name

**Pickens My Jeanty Draft Agent**

## 2. Problem statement

The user has a deep 16-team CBS keeper league with two keepers and unusual draft capital after a trade. During a live draft, the user wants help avoiding mistakes such as:

- missing a player who has fallen far below ADP,
- over-drafting a positional need,
- taking a QB/TE too early when RB/WR value is superior,
- failing to notice a positional run,
- drafting a player already selected,
- misclicking in the CBS interface,
- timing out while manually comparing options.

A static ranking sheet is useful but insufficient because the best pick changes as the draft unfolds.

## 3. User goals

### Primary

- Make the best possible selection at each of the user's draft turns.
- Use the supplied SportsLine rankings as a core input.
- Incorporate the user's exact league structure, keepers, and pick inventory.
- Update recommendations immediately after every league pick.
- Minimize the probability of an accidental/invalid pick.

### Secondary

- Keep a readable explanation for every recommendation.
- Offer a manual fallback at all times.
- Maintain an auditable event log.
- Make it easy to update the 32 official keepers after the lock date.
- Make it easy to update draft picks after any future trades.

## 4. Non-goals for MVP

- General-purpose multi-platform support.
- Full season waiver/trade automation.
- Scraping arbitrary fantasy-analysis websites live during every pick.
- Automatically entering CBS credentials.
- Relying on screenshots/OCR when DOM data is available.
- Letting an LLM control the entire browser without deterministic guards.

## 5. Known league context

Current information supplied by the user:

- 16 teams.
- CBS Fantasy Sports / Football Commissioner.
- Head-to-Head Points (PPR).
- 2 keepers.
- User is drafting from slot 3.
- Keepers: Ashton Jeanty, George Pickens.
- Kenneth Walker III was traded with overall pick #62 in exchange for overall pick #21.
- Observed starters: QB x1, RB x2, WR x3, TE x1, K x1, DST x1.
- User's early draft assets currently include #3, #21, #30, #35, #67, #94, #99, #126, #131, #158, subject to live CBS verification.

## 6. Data sources

### Required

**SportsLine workbook**

The supplied workbook is the initial ranking source. It contains per-position sheets and the fields:

- Optimal Position Rating
- Player
- ADP
- Round
- Bye Week

The importer must not silently invent missing values.

**CBS live draft room**

CBS is the live source of truth for:

- current overall pick,
- team on the clock,
- available/taken players,
- user's roster,
- draft results,
- countdown clock if exposed,
- optional projected fantasy points / SportsLine projections visible in the player table.

### Optional later

- Officially verified injury/news feed.
- Additional projection set.
- Historical/mock draft data for calibration.

## 7. User modes

### Monitor

Read and log the live draft. Do not recommend or click.

### Recommend

Display best player + backups + score explanation. Do not click.

### Confirm

Prepare the pick and show a single confirmation action. This should be the default live mode after testing.

### Autopilot

Submit automatically only if all safety gates pass. Must be explicitly enabled in config and ideally toggled in-session.

## 8. Success metrics

MVP engineering metrics:

- 100% parse success for all nonblank players in the supplied SportsLine workbook.
- 0 duplicate normalized player IDs within the reference workbook unless flagged for manual reconciliation.
- 100% deterministic replay: same state/config -> same shortlist.
- 100% rejection of AI answers that select outside the supplied shortlist.
- 0 duplicate pick submissions in mock tests.
- Read-only CBS adapter can reconstruct at least 99% of draft events from a mock/live rehearsal.
- Executor stops rather than guesses on selector mismatch.

Draft quality metrics:

- Recommendations should preserve falling value relative to ADP.
- Roster construction should not prematurely fill K/DST while meaningful RB/WR depth remains.
- 16-team positional scarcity must be reflected, especially RB and 3-WR demand.
- QB should rise in value compared with a 10/12-team league, but not automatically override elite RB/WR value.

## 9. Required operator visibility

At every user pick, show:

- current overall pick,
- user's current roster by position,
- top 5–10 candidates,
- deterministic score,
- SportsLine rating,
- ADP and ADP value delta,
- position need/scarcity contribution,
- projection/VOR contribution if available,
- AI choice and confidence if AI was used,
- fallback choice,
- warnings (bye overlap, roster max, unavailable, duplicate identity, stale state).

## 10. Hard safety requirements

- No credential automation.
- Domain allowlist.
- No pick action outside user's turn.
- No pick action for a player not currently available.
- No double-submit for the same overall pick.
- No AI-created player IDs.
- No raw page instructions passed blindly to the AI.
- No silent recovery after a verification failure; alert and stop.


---

## SOURCE FILE: `docs/ARCHITECTURE.md`

# Architecture

## 1. Architecture summary

Use a **local Node.js + TypeScript process** with Playwright and the OpenAI SDK.

```text
SportsLine XLSX -----> Data Importer ------\
League Config ------> Config Loader --------> Draft State / Candidate Engine
Keeper List --------> State Store ---------/              |
CBS Draft Room -----> CBS Reader --------------------------|
                                                          v
                                              Deterministic Shortlist
                                                          |
                                             optional OpenAI ranking
                                                          |
                                             Decision + safety gates
                                                          |
                             +----------------------------+------------------+
                             |                                               |
                        Recommend UI                                  CBS Executor
                             |                                               |
                             +----------------------- verify <---------------+
                                                      |
                                                  Event Log
```

## 2. Why Node.js + TypeScript

- Playwright's first-class JS/TS API is mature.
- OpenAI has an official TypeScript SDK.
- Cursor handles TypeScript projects well.
- Zod provides runtime validation and maps cleanly to OpenAI Structured Outputs.
- A single runtime can handle browser state, model calls, data parsing, and a lightweight local UI/CLI.

## 3. Components

### `SportslineImporter`

Responsibilities:

- Read every expected position sheet.
- Convert rows to typed records.
- Drop blank ranking rows.
- Normalize whitespace.
- Normalize DST naming.
- Preserve original player text for audit.
- Generate a stable normalized key.
- Report collisions instead of silently merging them.

### `LeagueConfigLoader`

Loads:

- teams,
- draft type,
- roster limits,
- keepers,
- pick inventory,
- scoring format,
- execution mode,
- strategy weights.

Every config must be Zod-validated at startup.

### `DraftStateStore`

Authoritative local state includes:

- current pick,
- draft events in order,
- keepers,
- user's roster,
- available pool,
- picks remaining,
- last confirmed CBS snapshot hash,
- last submitted pick ID.

Use an append-only JSONL event log plus a derived in-memory state. This is easier to debug than an opaque database during draft night.

### `CBSReader`

Read-only adapter that extracts structured state from the CBS page.

Important: the reader should return domain objects. No other part of the application should depend on CSS selectors.

### `DraftEngine`

Pure deterministic logic. Inputs:

- current state,
- player pool,
- league config,
- strategy config.

Outputs:

- ordered `CandidateScore[]`.

It must be fully unit-testable without a browser or OpenAI.

### `AIDecisionLayer`

Receives only the top deterministic candidates plus compact structured context. It may reorder candidates and explain the choice. It cannot add a new candidate.

### `CBSExecutor`

Separate from the reader. This separation is intentional.

Responsibilities:

- assert user's turn,
- re-read target availability,
- select exact target,
- submit exactly once,
- verify result,
- throw a typed error on any mismatch.

### `OperatorUI`

MVP can be terminal output. Later, add a local web dashboard.

Recommended live display:

```text
PICK 21 — Pickens My Jeanty is on the clock — 00:47

1. Player A  WR  Score 91.4  SL 76  ADP 33.1  +12.1 ADP value
2. Player B  RB  Score 89.2  SL 60  ADP 34.3  +13.3 ADP value
3. Player C  WR  Score 87.8  SL 68  ADP 41.0  +20.0 ADP value

AI: Player A (0.87 confidence)
Fallback: Player A
Mode: CONFIRM
[Enter] draft Player A    [s] skip AI    [a] disable automation
```

## 4. State machine

```text
BOOT
  -> LOAD_DATA
  -> WAIT_FOR_CBS
  -> SYNC
  -> WAITING_FOR_OUR_TURN
  -> OUR_TURN_DETECTED
  -> FREEZE_SNAPSHOT
  -> VALIDATE_STATE
  -> SCORE_CANDIDATES
  -> AI_DECISION (optional)
  -> FINAL_VALIDATE
  -> RECOMMEND | AWAIT_CONFIRM | EXECUTE
  -> VERIFY_CBS_RESULT
  -> COMMIT_EVENT
  -> SYNC
```

Every transition should be logged.

## 5. Failure behavior

Failure should be **fail-closed**.

Examples:

- CBS selector disappears -> stop clicking, continue manual.
- AI timeout -> deterministic candidate remains available.
- Candidate became unavailable -> recompute from a fresh snapshot.
- CBS says different team is on clock -> do not act.
- Result verification fails -> disable executor until operator intervention.
- Page reloads -> reader resyncs from draft results before continuing.

## 6. No direct “AI browser agent” in the primary path

OpenAI's computer-use tools can operate UIs, but for this use case deterministic Playwright is the preferred production path. Computer use is more appropriate as a development helper or emergency diagnostic than as the routine pick executor.

The final pick is a small, high-consequence, time-limited action. DOM-driven automation plus verification is easier to test and constrain.


---

## SOURCE FILE: `docs/DRAFT_ENGINE.md`

# Draft Decision Engine

## 1. Philosophy

The engine should make a strong decision even if the OpenAI API is unavailable. AI improves tie-breaking and strategic interpretation; it should not be required for basic competence.

## 2. Inputs

Per player, prefer these fields when available:

- SportsLine optimal position rating (0–100)
- SportsLine ADP
- SportsLine listed round
- bye week
- CBS projected fantasy points (if readable live)
- CBS position rank (if readable live)
- availability
- team/NFL team identity
- roster eligibility

Context:

- current overall pick
- user's next pick(s)
- roster already drafted/kept
- remaining starter requirements
- bench depth
- number of remaining teams needing each position
- recent positional run
- available tier depth

## 3. SportsLine source limitations

The supplied workbook contains only:

`rating, player, ADP, round, bye week`.

Do not claim that the spreadsheet itself supplies projections or VOR.

If projected fantasy points become available from CBS, VOR can be computed. Otherwise use SportsLine rating and scarcity-based proxies.

## 4. Baseline scoring model

Start with an interpretable weighted score. Do not pretend the initial weights are scientifically calibrated; they are defaults to validate through mock drafts.

Suggested normalized components:

- `sportslineRating`: 0–100.
- `adpValue`: reward a player lasting beyond ADP.
- `rosterNeed`: dynamic need for the position.
- `scarcity`: quality drop from this player to plausible alternatives.
- `nextPickRisk`: chance this player is unavailable by user's next pick.
- `vor`: optional, only when projected points exist.
- `tierCliff`: local change in SportsLine rating among available players.
- `byePenalty`: small only; never dominate talent/value.
- `positionLimitPenalty`: hard exclusion if roster max would be violated.

Initial formula:

```text
score =
  0.38 * sportslineRating
+ 0.18 * adpValue
+ 0.15 * rosterNeed
+ 0.12 * scarcity
+ 0.10 * nextPickRisk
+ 0.07 * tierCliff
+ optional VOR adjustment
- penalties
```

All component values should be normalized to roughly 0–100 before weighting.

The exact weights live in config so mock-draft testing can tune them.

## 5. ADP value

Define:

```text
adpDelta = currentOverallPick - playerADP
```

Positive means the player has fallen later than market ADP.

Use a bounded transform so a huge fall helps but does not overwhelm every other factor. Example:

```text
adpValue = 50 + 50 * tanh(adpDelta / 24)
```

Interpretation:

- player going exactly at ADP -> ~50
- falling ~24 picks -> strong value
- being drafted far earlier than ADP -> low value

Keeper leagues complicate raw ADP because 32 players disappear before the live pool. Therefore raw ADP is a **market-value signal**, not a direct expected live-draft pick number.

## 6. Roster need

Example need logic for the user's observed lineup:

- RB and WR remain important early because 2 RB + 3 WR start in a 16-team league.
- Once the user has 2 playable RBs and 3 playable WRs, the marginal need shifts toward TE/QB and depth.
- QB scarcity is stronger than in a 12-team league because 16 starters are required, but a mid-tier QB should not automatically beat a falling premium RB/WR.
- K/DST should carry strong early penalties until late roster construction unless the league's settings force otherwise.

Need should be dynamic, not a static position multiplier.

## 7. Scarcity

Two useful measures:

### Local tier cliff

For a candidate, compare its SportsLine rating to the next several available players at that position.

```text
tierCliff = candidateRating - median(next 3–5 available ratings)
```

Large positive cliff means passing may be costly.

### Starter demand

Estimate how many league-wide starter slots remain unfilled at each position and how many viable players remain. A deep 16-team league should increase scarcity pressure at RB and at QB relative to ordinary 12-team defaults.

## 8. Next-pick risk

The user's pick spacing is unusual because of the acquired #21. Around the early draft, the user's important sequence is:

`#3 -> #21 -> #30 -> #35 -> #67`

A player at #30 only needs to survive 5 picks to reach #35, while a player passed at #35 must survive 32 picks to reach #67.

The engine should explicitly use `nextPickOverall - currentPick` when deciding whether it is safe to wait.

A simple initial heuristic can combine:

- ADP,
- number of picks until user's next turn,
- current positional run,
- remaining teams with need at that position.

Later, replace the heuristic with a simulation calibrated on mock-draft logs.

## 9. VOR when projections are available

If CBS exposes projected fantasy points, compute replacement baselines dynamically.

The concept mirrors the useful approach in `jjti/ff`: replacement depends on league size, roster structure, scoring, and the draft's evolving player pool.

For example, the replacement QB in a 16-team 1-QB league is much lower than the replacement QB in a 10-team league.

Do not hardcode “QB17” forever; update replacement estimates as rosters fill and the pool changes.

## 10. AI shortlist

The deterministic engine should send only top candidates to AI, normally 7.

Before AI call, exclude:

- keepers,
- drafted players,
- wrong/ambiguous identities,
- unavailable CBS rows,
- players violating roster limits,
- K/DST before configured draft stage unless explicitly allowed.

## 11. Draft strategy encoded from current plan

This is a soft prior, not a rigid script:

- #3: premium RB/WR; elite TE only if extraordinary pool outcome.
- #21: RB/WR, favor balancing the #3 selection.
- #30/#35: treat as a pair; aim to emerge with strong RB/WR core, while allowing premium TE/QB fallers.
- #67: QB/TE checkpoint if one remains empty.
- #94/#99: finish missing QB/TE or take strong RB/WR value.
- later: RB/WR upside and depth.
- K/DST late.

The engine should override this plan when a materially better player falls.


---

## SOURCE FILE: `docs/CBS_INTEGRATION.md`

# CBS Integration Plan

## 1. Integration strategy

Do not assume a supported CBS draft-pick API exists. Treat the web draft room as the live integration boundary unless a supported endpoint is independently verified.

Use Playwright against a visible browser.

## 2. Authentication

The user logs into CBS manually.

Recommended approach:

```ts
chromium.launchPersistentContext("./.local/cbs-browser-profile", {
  headless: false,
  channel: "chrome"
});
```

The program should open CBS, then wait for the user to finish authentication.

Do not:

- ask for a CBS password in the app,
- save username/password,
- inject cookies copied from unrelated tools,
- log session cookies.

## 3. Selector discovery

Screenshots are useful context but are not enough to create reliable selectors.

When the live draft room is accessible:

1. Run Playwright MCP in Cursor, or `npx playwright codegen <draft-room-url>`.
2. Inspect accessible roles/text.
3. Record stable selectors.
4. Prefer role/text/test-id selectors.
5. Store selectors in a dedicated CBS adapter/config.
6. Add a diagnostics command that prints which selectors resolved.

Never scatter raw selectors throughout the codebase.

## 4. Fields to extract

At minimum:

### Draft control

- current overall pick
- current round/pick if exposed
- team currently on clock
- “you are up” state
- countdown timer

### Available player table

Per visible/all player:

- name
- position
- NFL team
- bye
- CBS/SportsLine projected points if visible
- CBS rank if visible
- ADP if visible
- stable row/player identifier if present

### Draft results

- overall pick
- fantasy team
- selected player
- round

### User roster

- players currently assigned to the user's team
- positional counts

### Queue

Optional in early phases:

- current queued player order

## 5. Read strategy

Prefer DOM/accessibility parsing over screenshots/OCR.

If the player table uses virtualization, the adapter may need to:

- use CBS search box for specific candidates,
- inspect backing DOM/data attributes,
- scroll intentionally,
- or parse network responses only if doing so is reliable and permitted.

Do not scrape pixels if structured data is available.

## 6. Synchronization

The draft results panel is the preferred source for rebuilding state after a reconnect.

On startup or page reload:

1. Read all visible draft results.
2. Compare against local event log.
3. Reconcile only if identity is unambiguous.
4. Mark conflicting state as `needs_operator_review`.
5. Never assume missing local events mean CBS is wrong.

CBS is the source of truth for which players were actually drafted.

## 7. Pick execution

The executor should work by exact identity:

1. Search/filter for target candidate if useful.
2. Match normalized player name + position + NFL team.
3. Re-check player is available.
4. Assert user is on clock.
5. Perform the minimal selection action.
6. If CBS has a confirmation step, validate the candidate again and confirm.
7. Watch draft results until target appears under the user's team.
8. Verify overall pick advanced.

## 8. Idempotency

Create a unique execution key:

```text
leagueId + season + expectedOverallPick
```

Persist it before/while attempting execution. If the key has already successfully completed, the executor must refuse another submission.

## 9. Native CBS Autopilot and queue

CBS currently documents:

- a native Autopilot function for absent/timed-out managers,
- a player queue in the Draft Room,
- roster-position maximums that can constrain native autopilot.

Use CBS native Autopilot as a **fallback**, not as the primary strategy engine.

A later phase can maintain a short queue (for example 5–10 players) that mirrors the local recommendation order. If the custom process fails, CBS has a reasonable emergency list rather than a generic one.

## 10. Dry-run mode

Implement an executor flag:

```text
CBS_EXECUTION_ENABLED=false
```

In dry-run mode, the system should log exactly what it would click and capture enough page state for debugging, but never perform the final selection.

Dry-run must be the default until the user explicitly opts in.


---

## SOURCE FILE: `docs/AI_DECISION_LAYER.md`

# OpenAI Decision Layer

## 1. Purpose

Use OpenAI for strategic tie-breaking and synthesis, not for raw page control.

The model should answer a constrained question:

> Given these 7 already-validated candidates and this exact draft state, which candidate best fits the configured strategy?

It should not be asked:

> Browse the draft and pick anybody you want.

## 2. API

Use the OpenAI **Responses API** with the official TypeScript SDK.

Use **Structured Outputs** so the result conforms to a Zod/JSON schema.

Current recommended configurable default:

- model: `gpt-5.6`
- reasoning effort: `low` for live draft latency
- timeout: approximately 5–8 seconds (configurable)

For offline analysis/mocks, higher reasoning can be used.

## 3. Decision schema

Suggested schema:

```ts
const DraftDecisionSchema = z.object({
  selectedCandidateId: z.string(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(600),
  alternativeCandidateIds: z.array(z.string()).max(4),
  riskFlags: z.array(z.enum([
    "NONE",
    "POSITION_RUN",
    "TIER_CLIFF",
    "ROSTER_IMBALANCE",
    "BYE_OVERLAP",
    "LOW_CONFIDENCE",
    "STALE_DATA"
  ]))
});
```

After parsing, enforce:

```text
selectedCandidateId must be in candidateIds
all alternativeCandidateIds must be in candidateIds
```

If not, reject the response.

## 4. Prompt design

The system/developer prompt should encode stable rules:

- Full PPR.
- 16 teams.
- 3 starting WRs.
- Keepers already on roster.
- Prefer meaningful RB/WR value early.
- Account for QB scarcity in a 16-team league without blindly reaching.
- Use TE tier cliffs.
- K/DST late.
- SportsLine rating is a trusted model input, not an absolute command.
- ADP is market information; keeper removal distorts direct live-draft equivalence.
- Do not select outside the supplied list.

The user content sent on each pick should be JSON-like structured state, not a giant prose transcript.

## 5. Example model input

```json
{
  "currentOverallPick": 30,
  "nextUserPick": 35,
  "roster": {
    "QB": [],
    "RB": ["Ashton Jeanty"],
    "WR": ["George Pickens", "Player X"],
    "TE": []
  },
  "recentPositionCounts": {"RB": 4, "WR": 6, "QB": 1, "TE": 0},
  "candidates": [
    {
      "id": "...",
      "name": "...",
      "position": "WR",
      "sportslineRating": 68,
      "adp": 41.0,
      "deterministicScore": 90.1,
      "componentScores": {...}
    }
  ]
}
```

## 6. Fallback rules

If model call:

- times out,
- errors,
- refuses,
- returns invalid structured output,
- chooses outside shortlist,
- confidence is below configured threshold,

then use deterministic candidate #1.

AI failure should never cause a random pick.

## 7. Why not use Computer Use as the normal executor

OpenAI supports computer-use harnesses, including with Playwright, but the official guidance emphasizes isolation, allowlists, and human involvement for authenticated/high-impact actions.

For this project, the AI does not need to interpret the browser to make the football decision. Playwright can extract reliable structured state, which is easier to validate and less vulnerable to prompt injection or visual ambiguity.

Computer use can still be helpful during development when diagnosing an unfamiliar CBS UI state.

## 8. Security

- `OPENAI_API_KEY` lives in `.env` only.
- `.env` is gitignored.
- Never expose the key to browser page JavaScript.
- All model requests originate from the local Node process.
- Do not send CBS cookies/session tokens to OpenAI.
- Do not send raw HTML unless absolutely necessary.
- Strip unrelated chat/page text from model context.


---

## SOURCE FILE: `docs/SAFETY_RELIABILITY.md`

# Safety and Reliability Design

## 1. Reliability target

The software should prefer **doing nothing** over making an unverified selection.

## 2. Safety gates before any automatic pick

All must pass:

1. Execution mode is `autopilot`.
2. CBS execution feature flag is enabled.
3. Current domain matches allowlist.
4. User team identity matches config.
5. Expected overall pick matches live page.
6. Live page says user's team is on the clock.
7. Countdown has enough time remaining for a safe action, if timer is available.
8. Local draft state is recently synchronized.
9. Target is present in deterministic candidate set.
10. Target still exists as available in CBS.
11. Target name/position/team identity is unambiguous.
12. Roster rules permit the target.
13. No successful execution exists for the current pick id.
14. No unresolved prior verification failure exists.

## 3. Post-action verification

After the click, wait for a CBS result event that proves:

- same overall pick,
- user's fantasy team,
- exact selected player,
- pick number advances.

If not observed within timeout:

- do not click again,
- mark state `verification_failed`,
- disable auto execution,
- alert user.

## 4. Staleness

Every browser snapshot gets a timestamp.

Before execution, refresh/re-read critical fields. Do not act on a shortlist computed from stale availability.

Suggested threshold: 2 seconds for availability/user-turn checks immediately before a pick action.

## 5. Prompt injection resistance

CBS page content is untrusted data.

The AI layer should receive normalized fields, not raw page prose. For example:

Good:

```json
{"player":"Player A","position":"RB","available":true}
```

Bad:

```text
<entire page HTML including chat room messages and ads>
```

League chat, ads, and arbitrary page text should never enter the model prompt.

## 6. Observability

Write structured logs with:

- timestamp
- state-machine state
- pick number
- browser snapshot hash
- top candidates
- deterministic component scores
- model latency
- model decision
- execution action
- verification result
- error type

Avoid secrets/cookies.

## 7. Event log example

```json
{"type":"draft_pick_seen","overallPick":20,"team":"F.A.F.O.","player":"...","ts":"..."}
{"type":"our_turn","overallPick":21,"ts":"..."}
{"type":"recommendation","overallPick":21,"candidateId":"...","score":91.2,"ts":"..."}
{"type":"ai_decision","overallPick":21,"candidateId":"...","confidence":0.89,"ts":"..."}
{"type":"pick_submitted","overallPick":21,"candidateId":"...","ts":"..."}
{"type":"pick_verified","overallPick":21,"candidateId":"...","ts":"..."}
```

## 8. Emergency controls

At runtime provide:

- `a` — disable autopilot immediately.
- `m` — switch to monitor mode.
- `r` — force resync from CBS draft results.
- `q` — quit without browser actions.

Never bind a dangerous action to a single ambiguous hotkey without clear terminal focus.

## 9. Network failure

If internet/OpenAI connectivity fails:

- CBS browser may still work if connectivity returns quickly.
- Deterministic engine should remain functional.
- If CBS cannot be read reliably, stop automation.
- Keep the human-readable spreadsheet as fallback.

## 10. Platform rules

Recommendation/monitor mode should be built first and remains useful regardless of whether the user ultimately enables browser-submitted picks.

Before full autopilot, the user should review current CBS/league rules. The project must not depend on bypassing access controls or hidden authentication mechanisms.


---

## SOURCE FILE: `docs/TEST_PLAN.md`

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


---

## SOURCE FILE: `docs/IMPLEMENTATION_PLAN.md`

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


---

## SOURCE FILE: `docs/RESEARCH_NOTES.md`

# Research Notes and Primary References

Research date: August 13, 2026.

These references informed the architecture. Re-check them before major upgrades because APIs/UI behavior can change.

## OpenAI

### Responses / model guidance

- https://developers.openai.com/api/docs
- https://developers.openai.com/api/docs/guides/reasoning
- https://developers.openai.com/api/docs/guides/structured-outputs

Current OpenAI documentation recommends the Responses API for reasoning workflows. Structured Outputs can enforce a supplied schema. The current docs recommend starting with `gpt-5.6` for reasoning workloads, with configurable reasoning effort/mode.

### Computer use

- https://developers.openai.com/api/docs/guides/tools-computer-use

OpenAI documents computer-use harnesses and explicitly recommends isolated environments, domain/action constraints, and human involvement for authenticated or difficult-to-reverse actions. This is one reason the project uses deterministic Playwright for the pick executor and uses the model primarily as a bounded decision layer.

## Playwright

- https://playwright.dev/docs/locators
- https://playwright.dev/docs/best-practices
- https://playwright.dev/docs/getting-started-mcp

Playwright recommends resilient locators such as role/text/label-based locators, and its MCP server is documented as compatible with Cursor. Use MCP/codegen to discover the real CBS selectors instead of guessing from screenshots.

## CBS Fantasy Football

- https://help.football.cbssports.com/s/article/How-does-Autopilot-work
- https://help.football.cbssports.com/s/article/How-can-I-place-players-into-my-draft-room-queue
- https://help.football.cbssports.com/s/article/How-do-I-avoid-too-many-players-at-a-specific-position-being-drafted-by-autopilot

CBS documents native Autopilot and the Draft Room player queue. The custom tool should treat those as fallback mechanisms.

## Related open-source projects

### jjti/ff

- https://github.com/jjti/ff

This project uses projections and value-over-replacement concepts and explicitly discusses how league size, roster format, scoring, ADP, and other drafters change VOR. The current project borrows the architectural idea of dynamic replacement/scarcity but does not copy code unless license compatibility is reviewed.

### Google Gemini fantasy workshop

- https://github.com/google-gemini/workshops/tree/main/fantasy

Google's workshop demonstrates a Chrome-extension/server fantasy draft companion architecture for Sleeper. It is useful as an example of coupling a live draft UI to an AI assistant.

### Fantasy Football Metrics Weekly Report

- https://github.com/uberfastman/fantasy-football-metrics-weekly-report

This project currently supports CBS for read/report workflows and notes use of an older CBS API that was once publicly documented. It is useful as reference for CBS data access history, but this draft agent should not assume an undocumented draft-write endpoint exists.

## NPM versions observed during research

As of research date:

- `openai` 7.4.0
- `playwright` 1.62.1
- `zod` 4.4.3
- `xlsx` 0.18.5

Pinning is recommended for draft-week stability, then update intentionally after the season.
