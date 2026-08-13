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
