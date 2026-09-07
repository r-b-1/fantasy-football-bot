import { loadLeagueConfig, loadStrategyConfig } from "../config/load.js";
import { loadRosterGrid } from "../data/rosterGrid.js";
import { loadSportslineWorkbook } from "../data/sportsline.js";
import { predictNextPicks } from "../ai/predict.js";
import { formatProjection } from "../cli/format.js";
import type { LivePlayer } from "../domain/types.js";
import { playerKey } from "../data/normalize.js";
import { loadRichFixtureScript } from "./fixtureData.js";
import { isAllowedCbsUrl } from "./allowlist.js";
import { startFixtureServer } from "./fixtureServer.js";
import { CBSReader } from "./reader.js";
import { assertFixtureSelectorConfig, loadSelectorConfig } from "./selectors.js";
import { closeSession, openEphemeralBrowser } from "./session.js";
import { appendEvent } from "../state/eventLog.js";
import { toLivePlayers } from "../engine/state.js";

export interface ProjectOptionConfig {
  headless?: boolean;
  intervalMs?: number;
  useAI?: boolean;
  untilPick?: number;
  pauseOnUser?: boolean;
}

export async function runFixtureProjection(options: ProjectOptionConfig = {}): Promise<void> {
  const league = loadLeagueConfig(process.env.LEAGUE_CONFIG ?? "config/league.current.json");
  const strategy = loadStrategyConfig(process.env.STRATEGY_CONFIG ?? "config/strategy.current.json");
  const richScript = loadRichFixtureScript();
  const players: LivePlayer[] = toLivePlayers(
    loadSportslineWorkbook(process.env.SPORTSLINE_XLSX ?? "data/reference/cheatsheet_cbsppr12.xlsx"),
    new Set(richScript.keepers.map((keeper) => playerKey(keeper.name, keeper.position)))
  );
  const rosterGrid = league.rosterGridPath ? loadRosterGrid(league.rosterGridPath) : undefined;
  const selectors = loadSelectorConfig("config/selectors.fixture.json");
  assertFixtureSelectorConfig(selectors);

  const useAI = options.useAI ?? true;
  const intervalMs = options.intervalMs ?? 400;
  const untilPick = options.untilPick ?? 0;
  const eventLogPath = process.env.EVENT_LOG;

  const server = await startFixtureServer();
  const query = new URLSearchParams({ autoplay: "1", intervalMs: String(intervalMs) });
  if (untilPick > 0) query.set("untilPick", String(untilPick));
  if (options.pauseOnUser === false) query.set("pauseOnUser", "0");

  const session = await openEphemeralBrowser(options.headless ?? false);
  const projectedPicks = new Set<number>();
  try {
    await session.page.goto(`${server.richUrl}?${query.toString()}`, { waitUntil: "domcontentloaded" });
    if (isAllowedCbsUrl(session.page.url())) {
      throw new Error("Safety abort: fixture projection landed on CBS");
    }

    console.log("LOCAL FAKE DRAFT ROOM — projection mode — not CBS, no clicks, no live draft profile.");
    console.log(`Watching ${session.page.url()}`);
    console.log(
      `Projection banner will print on each non-user poll. AI ${useAI ? "ENABLED" : "DISABLED"} (set --no-ai to force deterministic).`
    );
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
        `POLL  PICK ${snapshot.control.currentOverallPick ?? "?"} — ${snapshot.control.teamOnClock ?? "unknown"} — ${clock}${snapshot.control.isUserTurn ? "  [user turn — projection skipped]" : ""}`
      );
      const latest = snapshot.results.slice(-3);
      for (const result of latest) {
        console.log(`  ${result.overallPick}. ${result.fantasyTeam} — ${result.playerName}`);
      }

      const pickKey = snapshot.control.currentOverallPick ?? 0;
      if (
        !snapshot.control.isUserTurn &&
        pickKey > 0 &&
        !projectedPicks.has(pickKey) &&
        snapshot.results.length > 0
      ) {
        projectedPicks.add(pickKey);
        const state = await reader.readDraftState(players, {
          recentPickWindow: strategy.recentPickWindow
        });
        const projection = await predictNextPicks({
          players,
          state,
          league,
          strategy,
          useAI,
          rosterGrid,
          keepers: richScript.keepers.map((k) => ({
            fantasyTeam: k.fantasyTeam,
            playerName: k.name,
            position: k.position
          }))
        });
        console.log(formatProjection(projection));
        if (eventLogPath && projection.projectedPicks.length > 0) {
          appendEvent(eventLogPath, {
            type: "projection",
            overallPick: projection.currentOverallPick,
            horizon: projection.horizon,
            source: projection.source,
            picks: projection.projectedPicks.map((p) => ({
              playerId: p.playerId,
              playerName: p.playerName,
              position: p.position,
              expectedOverallPick: p.expectedOverallPick,
              confidence: p.confidence
            })),
            ...(projection.fallbackReason ? { fallbackReason: projection.fallbackReason } : {})
          });
        }
      }

      if (untilPick > 0 && pickKey >= untilPick && snapshot.control.isUserTurn) break;
      await session.page.waitForTimeout(intervalMs);
    }
  } finally {
    await closeSession(session);
    await server.close();
  }
}
