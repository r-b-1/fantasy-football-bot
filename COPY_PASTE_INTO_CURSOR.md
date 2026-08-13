# Copy/paste this into Cursor Agent

Read `MASTER_SPEC_FOR_CURSOR.md`, `.cursor/rules/draft-agent.mdc`, and the existing starter source before changing code.

You are implementing the **Pickens My Jeanty CBS Fantasy Draft Agent**. Treat correctness and safe failure as more important than automation speed.

Start with **Phase 1 only** from `docs/IMPLEMENTATION_PLAN.md`:

1. Make the project install/typecheck/test cleanly on Node 20+.
2. Finish and harden the SportsLine XLSX importer against `data/reference/cheatsheet_cbsppr12.xlsx`.
3. Validate `config/league.current.json` and `config/strategy.current.json` with Zod.
4. Finish the deterministic ranking engine and make every score component explainable.
5. Add realistic fixture-based 16-team draft replay tests.
6. Add a CLI command that can load a fixture, remove keepers/drafted players, and print a ranked shortlist.
7. Do not implement live CBS clicking yet.

When Phase 1 is passing, move to Phase 2. For CBS integration, use Playwright MCP/codegen against the user's actual logged-in CBS draft room. **Never guess selectors from screenshots.** Keep authentication manual and local. Build read-only state extraction before any write action.

For AI decisions, use the official OpenAI TypeScript SDK, Responses API, and Structured Outputs. The model may choose only from the deterministic shortlist. Any invalid/out-of-list answer, timeout, low confidence, or API error must fall back to the deterministic top choice.

Before implementing an automatic pick executor, require the mock-draft readiness gates in `docs/TEST_PLAN.md`. The executor must fail closed, be idempotent by overall pick, revalidate availability immediately before acting, and verify the final CBS draft result afterward.

Do not silently change the user's league assumptions. If live CBS data contradicts the config (draft type, lineup, picks, keepers), surface the conflict and make the live source/config update explicit.
