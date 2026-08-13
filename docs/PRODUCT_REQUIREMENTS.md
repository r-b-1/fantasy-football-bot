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
