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
PICK 21 — Front Runner is on the clock — 00:47

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
