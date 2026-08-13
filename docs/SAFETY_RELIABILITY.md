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
