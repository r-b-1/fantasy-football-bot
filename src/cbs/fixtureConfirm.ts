import { loadLeagueConfig, loadStrategyConfig } from "../config/load.js";
import { loadSportslineWorkbook } from "../data/sportsline.js";
import { deterministicDecision } from "../engine/decision.js";
import { generateShortlist } from "../engine/shortlist.js";
import { formatRecommendation } from "../cli/format.js";
import { appendEvent } from "../state/eventLog.js";
import { isAllowedCbsUrl } from "./allowlist.js";
import { FixtureExecutor } from "./fixtureExecutor.js";
import { startFixtureServer } from "./fixtureServer.js";
import { CBSReader } from "./reader.js";
import { assertFixtureSelectorConfig, loadSelectorConfig } from "./selectors.js";
import { closeSession, openEphemeralBrowser, waitForManualLogin } from "./session.js";

export interface FixtureConfirmOptions {
  headless?: boolean;
  autoConfirm?: boolean;
  everyPickIsUser?: boolean;
  untilPick?: number;
  intervalMs?: number;
  logPath?: string;
}

export async function runFixtureConfirm(options: FixtureConfirmOptions = {}): Promise<void> {
  const league = loadLeagueConfig(process.env.LEAGUE_CONFIG ?? "config/league.current.json");
  const strategy = loadStrategyConfig(process.env.STRATEGY_CONFIG ?? "config/strategy.current.json");
  const players = loadSportslineWorkbook(
    process.env.SPORTSLINE_XLSX ?? "data/reference/cheatsheet_cbsppr12.xlsx"
  );
  const selectors = loadSelectorConfig("config/selectors.fixture.json");
  assertFixtureSelectorConfig(selectors);

  const server = await startFixtureServer();
  const session = await openEphemeralBrowser(options.headless ?? false);
  const everyPickIsUser = options.everyPickIsUser ?? false;
  const query = new URLSearchParams({
    confirmMode: "1",
    autoplay: "1",
    intervalMs: String(options.intervalMs ?? 200)
  });
  if (everyPickIsUser) query.set("everyPickIsUser", "1");

  try {
    await session.page.goto(`${server.url}?${query.toString()}`, { waitUntil: "domcontentloaded" });
    if (isAllowedCbsUrl(session.page.url())) {
      throw new Error("Safety abort: fixture confirm landed on CBS");
    }
    await session.page.waitForFunction("typeof window.__fixtureDraft === 'function'");
    console.log("FAKE ROOM CONFIRM MODE — not CBS, clicks stay on 127.0.0.1, live draft is untouched.");
    console.log("Live CBS execution stays disabled. This never uses the persistent CBS Chrome profile.");
    console.log(`Watching ${session.page.url()}`);

    const logPath = options.logPath ?? process.env.EVENT_LOG;
    const reader = new CBSReader(session.page, selectors, league);
    const executor = new FixtureExecutor(session.page, reader, selectors, league, strategy, logPath);
    const handled = new Set<number>();
    const untilPick = options.untilPick ?? (everyPickIsUser ? 10 : 35);

    for (;;) {
      const snapshot = await reader.readLiveSnapshot(players);
      if (isAllowedCbsUrl(snapshot.url)) {
        throw new Error("Safety abort: fixture confirm saw a CBS URL");
      }
      const current = snapshot.control.currentOverallPick ?? 0;
      console.log(
        `FAKE  PICK ${current} — ${snapshot.control.teamOnClock ?? "unknown"}${snapshot.control.isUserTurn ? "  [our turn]" : ""}`
      );

      if (snapshot.control.isUserTurn && current > 0 && !handled.has(current)) {
        if (logPath) {
          appendEvent(logPath, { type: "our_turn", overallPick: current });
        }
        const state = await reader.readDraftState(players);
        const ranked = generateShortlist(
          players.map((player) => ({ ...player, available: state.availablePlayerIds.has(player.id) })),
          state,
          league,
          strategy
        );
        const decision = deterministicDecision(ranked);
        console.log(formatRecommendation(ranked, state, league, decision, { explain: "top" }));
        const selected =
          ranked.find((candidate) => candidate.player.id === decision.selectedCandidateId) ?? ranked[0]!;
        if (logPath) {
          appendEvent(logPath, {
            type: "shortlist",
            overallPick: current,
            candidateIds: ranked.map((candidate) => candidate.player.id)
          });
          appendEvent(logPath, {
            type: "recommendation",
            overallPick: current,
            candidateId: selected.player.id,
            playerName: selected.player.name,
            score: selected.score,
            notes: selected.notes
          });
        }
        if (!options.autoConfirm) {
          await waitForManualLogin(
            `Press Enter to draft ${selected.player.name} on the FAKE room (not CBS). Type Ctrl+C to stop.\n`
          );
        }
        await executor.executeConfirmedPick(selected, current);
        console.log(`VERIFIED fake pick ${current}: ${selected.player.name}`);
        handled.add(current);
      }

      if (executor.isDisabled) {
        console.error(`Executor disabled: ${executor.disableReasonText}`);
        break;
      }
      if (current > untilPick) break;
      if (current >= untilPick && handled.has(untilPick)) break;
      await session.page.waitForTimeout(250);
    }
  } finally {
    await closeSession(session);
    await server.close();
  }
}
