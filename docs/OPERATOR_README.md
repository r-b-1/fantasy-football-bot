# Operator guide — league-specific setup

This is the original project README: league context, SportsLine workbook notes, and live-draft operating rules.

The public GitHub README lives at the [repository root](../README.md).

---

# Pickens My Jeanty — CBS Fantasy Draft Agent

A local-first draft assistant/autopilot prototype for a **16-team CBS Fantasy Football keeper league**. The project is designed around the user's real league, current draft capital, two keepers, and the SportsLine CBS PPR 12-team spreadsheet supplied in this conversation.

## What this project is meant to do

1. Open a real CBS draft room in a visible browser.
2. Read live draft state from the page DOM/accessibility tree.
3. Load the supplied SportsLine rankings and current league configuration.
4. Maintain an authoritative list of available/drafted/keeper players.
5. Score candidates deterministically using value, roster need, positional scarcity, ADP, and optional projections.
6. Ask an OpenAI reasoning model to choose **only among a bounded shortlist** and return a strict structured decision.
7. Run in one of four modes:
   - `monitor`: observe only.
   - `recommend`: show the recommended player and backups.
   - `confirm`: prepare the pick, but require a human confirmation.
   - `autopilot`: submit the pick after all safety checks pass.
8. Verify that CBS recorded the correct player and pick before continuing.

## Why the architecture is hybrid instead of “just let AI click”

The goal is **fewer mistakes**, not maximum autonomy. A pure LLM browser agent can misread a page, click the wrong row, hallucinate an unavailable player, or fail under draft-clock pressure. This design puts deterministic software around the model:

- Playwright reads the page.
- Local state validates the page.
- A deterministic engine produces a candidate shortlist.
- The OpenAI model may rank the shortlist, but cannot invent candidates.
- A separate executor performs the browser action.
- Post-pick verification must succeed.
- If any invariant fails, the program stops and falls back to manual/CBS-native drafting.

## Current known league configuration

See `config/league.current.json`. The project currently encodes the following information from the conversation:

- Platform: CBS Fantasy Football Commissioner
- Teams: 16
- Scoring format: Head-to-Head Points, PPR
- Keeper slots: 2
- User team on CBS: `Pickens My Jeanty` (formerly `Front Runner`; confirm exact spelling/casing in the live draft room)
- Draft slot: 3rd
- Current keepers: Ashton Jeanty and George Pickens
- Completed trade: Kenneth Walker III + overall pick #62 for overall pick #21
- Starting lineup observed: 1 QB, 2 RB, 3 WR, 1 TE, 1 K, 1 DST
- Draft is assumed snake/serpentine based on the observed pick numbering. **Verify this before live use.**

Known early picks after the trade, assuming no other pick trades:

`3, 21, 30, 35, 67, 94, 99, 126, 131, 158, ...`

The full late-round list depends on how CBS handles roster size/keeper-round accounting, so the live CBS page is the source of truth.

## Included reference files

- `data/reference/cheatsheet_cbsppr12.xlsx` — supplied SportsLine CBS PPR 12-team sheet.
- `data/reference/roster-grid.csv` — supplied league roster grid snapshot.
- `data/reference/Pickens_My_Jeanty_Draft_Command_Center.xlsx` — previously generated human-readable backup plan.

The SportsLine workbook contains one sheet per position (`QB`, `RB`, `WR`, `TE`, `K`, `DST`) and these columns:

- `OPTIMAL POSITION RATING`
- `PLAYER`
- `ADP`
- `ROUND`
- `BYE WEEK`

It does **not** contain projected fantasy points. If the draft engine wants VOR based on projected points, those projections must come from the CBS draft-room DOM or another explicitly configured source.

## Start here in Cursor

Open this folder in Cursor and read:

1. `CURSOR_START_HERE.md`
2. `docs/PRODUCT_REQUIREMENTS.md`
3. `docs/ARCHITECTURE.md`
4. `docs/IMPLEMENTATION_PLAN.md`
5. `.cursor/rules/draft-agent.mdc`

Then implement **Phase 1 only** before attempting live pick execution.

## Recommended development sequence

- Phase 1: SportsLine importer + league config + deterministic scoring + replay tests.
- Phase 2: CBS read-only Playwright adapter.
- Phase 3: Live recommendation overlay/terminal output.
- Phase 4: Human-confirm pick execution.
- Phase 5: Native queue maintenance / fallback.
- Phase 6: Full autopilot after mock-draft validation.

Do not jump directly to Phase 6.

## Runtime principles

- Never store CBS username/password in code or `.env`.
- Log in manually in the visible browser and reuse a local Playwright profile.
- Never guess selectors. Discover them with Playwright MCP/codegen against the actual CBS page.
- Never allow the AI to choose a player not present in the local shortlist.
- Never submit if the app cannot prove it is the user's turn.
- Never submit if the target player is not still available immediately before the click.
- Never submit twice for the same overall pick.
- Never treat an AI timeout as permission to guess; fall back to the deterministic top candidate.
- Keep `autopilot` disabled by default.

## Important platform note

CBS documents its own draft queue and Autopilot features, but this project does not assume that CBS exposes a supported public endpoint for submitting draft picks. The implementation therefore treats the CBS web UI as the integration boundary unless a supported API is later verified. Browser automation should remain user-controlled and should be enabled only after the user is comfortable with the platform/league rules.
