import { loadLeagueConfig, loadStrategyConfig } from "../config/load.js";
import { loadSportslineWorkbook } from "../data/sportsline.js";
import { recommendTurn } from "../engine/recommend.js";
import { isAllowedCbsUrl } from "./allowlist.js";
import { startFixtureServer } from "./fixtureServer.js";
import { CBSReader } from "./reader.js";
import { assertFixtureSelectorConfig, loadSelectorConfig } from "./selectors.js";
import { closeSession, openEphemeralBrowser } from "./session.js";

export interface FixtureMonitorOptions {
  headless?: boolean;
  pauseAt?: number;
  intervalMs?: number;
  untilPick?: number;
}

export async function runFixtureMonitor(options: FixtureMonitorOptions = {}): Promise<void> {
  const league = loadLeagueConfig(process.env.LEAGUE_CONFIG ?? "config/league.current.json");
  const strategy = loadStrategyConfig(process.env.STRATEGY_CONFIG ?? "config/strategy.current.json");
  const players = loadSportslineWorkbook(
    process.env.SPORTSLINE_XLSX ?? "data/reference/cheatsheet_cbsppr12.xlsx"
  );
  const selectors = loadSelectorConfig("config/selectors.fixture.json");
  assertFixtureSelectorConfig(selectors);

  const server = await startFixtureServer();
  const pauseAt = options.pauseAt ?? 0;
  const intervalMs = options.intervalMs ?? 350;
  const untilPick = options.untilPick ?? 35;
  const query = new URLSearchParams({
    autoplay: "1",
    intervalMs: String(intervalMs)
  });
  if (pauseAt > 0) query.set("pauseAt", String(pauseAt));

  const session = await openEphemeralBrowser(options.headless ?? false);
  const seenUserTurns = new Set<number>();
  try {
    const target = `${server.url}?${query.toString()}`;
    await session.page.goto(target, { waitUntil: "domcontentloaded" });
    if (isAllowedCbsUrl(session.page.url())) {
      throw new Error("Safety abort: fixture monitor landed on CBS");
    }

    console.log("LOCAL FAKE DRAFT ROOM — not CBS, look-only, no clicks, no live draft profile.");
    console.log(`Watching ${session.page.url()}`);
    const reader = new CBSReader(session.page, selectors, league);

    for (;;) {
      const snapshot = await reader.readLiveSnapshot(players);
      if (isAllowedCbsUrl(snapshot.url)) {
        throw new Error("Safety abort: fixture reader saw a CBS URL");
      }
      const clock =
        snapshot.control.clockSecondsRemaining == null
          ? "n/a"
          : `${Math.floor(snapshot.control.clockSecondsRemaining / 60)}:${String(
              snapshot.control.clockSecondsRemaining % 60
            ).padStart(2, "0")}`;
      console.log(
        `LOOK-ONLY  PICK ${snapshot.control.currentOverallPick ?? "?"} — ${snapshot.control.teamOnClock ?? "unknown"} — ${clock}${snapshot.control.isUserTurn ? "  [our turn]" : ""}`
      );
      const latest = snapshot.results.slice(-3);
      for (const result of latest) {
        console.log(`  ${result.overallPick}. ${result.fantasyTeam} — ${result.playerName}`);
      }

      if (snapshot.control.isUserTurn && snapshot.control.currentOverallPick != null) {
        const pick = snapshot.control.currentOverallPick;
        if (!seenUserTurns.has(pick)) {
          seenUserTurns.add(pick);
          const state = await reader.readDraftState(players, { recentPickWindow: strategy.recentPickWindow });
          const decision = await recommendTurn({
            players,
            state,
            league,
            strategy,
            explain: "top"
          });
          console.log(decision.output);
        }
      }

      const current = snapshot.control.currentOverallPick ?? 0;
      if (pauseAt > 0 && current >= pauseAt) break;
      if (current >= untilPick && !snapshot.control.isUserTurn) break;
      await session.page.waitForTimeout(400);
    }
  } finally {
    await closeSession(session);
    await server.close();
  }
}
