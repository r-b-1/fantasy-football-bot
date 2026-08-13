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
