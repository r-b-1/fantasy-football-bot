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

### Starter-first shortlist

Roster construction is enforced before the final shortlist is sent to either the
deterministic picker or AI. Among eligible players, prefer players who fill a
configured starter opening over bench players. K/DST are still excluded before
the configured eligibility threshold, so their empty slots do not block earlier
RB/WR depth or useful QB/TE backups after the core starters are filled.

When no eligible player fills a starter opening, prefer RB/WR depth and at most
one backup beyond the configured QB/TE starter count. Spare K/DST and further
QB/TE backups are fallback choices only when no preferred depth is available.
These are recommendation priorities, not claimed CBS roster limits. If an
unfilled position has no eligible player, continue ranking the available options
rather than producing an empty shortlist.

SportsLine ratings, ADP, and scoring weights are unchanged. Score against the full
eligible pool, then apply roster priority before truncation, preserving the
existing rating, tier, and scarcity comparisons. A high positional rating is not
an overall draft rank and does not justify leaving a required starter empty.
This policy does not infer a final roster size from unknown bench slots or the
last pick in a partial pick inventory.

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
