import { loadLeagueConfig, loadStrategyConfig } from "../config/load.js";
import { loadRosterGrid } from "../data/rosterGrid.js";
import { resolveProjectionKeepers } from "../data/leagueKeepers.js";
import { loadSportslineWorkbook } from "../data/sportsline.js";
import { predictNextPicks } from "../ai/predict.js";
import { shouldProjectForTurn } from "../engine/predict.js";
import { formatProjection } from "../cli/format.js";
import type { LivePlayer } from "../domain/types.js";
import { toLivePlayers } from "../engine/state.js";
import { appendEvent } from "../state/eventLog.js";
import { resyncFromDraftResults } from "./resync.js";
import { CBSReader } from "./reader.js";
import { requiredReadSelectors, loadSelectorConfig, assertLiveSelectorConfig, resolveSelectorConfigPath } from "./selectors.js";
import { openAllowlistedCbsPage, openCBSSession, focusDraftRoomPage, waitForManualLogin } from "./session.js";
import { looksLikeCbsDraftRoom } from "./allowlist.js";
import { formatClockSeconds, formatOnClockStatus } from "./parse.js";
import { selectorsUnconfigured } from "./errors.js";

export async function runCbsMonitor(): Promise<void> {
  const selectorPath = resolveSelectorConfigPath();
  console.log(`Selector config: ${selectorPath}`);
  const league = loadLeagueConfig(process.env.LEAGUE_CONFIG ?? "config/league.current.json");
  const strategy = loadStrategyConfig(
    process.env.STRATEGY_CONFIG ?? "config/strategy.current.json"
  );
  const selectors = loadSelectorConfig(selectorPath);
  const sportslinePlayers = loadSportslineWorkbook(
    process.env.SPORTSLINE_XLSX ?? "data/reference/cheatsheet_cbsppr12.xlsx"
  );
  const players: LivePlayer[] = toLivePlayers(sportslinePlayers, new Set());
  const rosterGrid = league.rosterGridPath ? loadRosterGrid(league.rosterGridPath) : undefined;
  const keepers = resolveProjectionKeepers(league);
  const useAI = !process.argv.includes("--no-ai");
  const showProjection = !process.argv.includes("--no-projection");

  try {
    assertLiveSelectorConfig(selectors);
    if (requiredReadSelectors(selectors).length > 0) throw selectorsUnconfigured();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error("Run `npm run cbs:diagnose` in the logged-in draft room first. Do not guess selectors.");
    process.exitCode = 2;
    return;
  }

  const profileDir = process.env.CBS_BROWSER_PROFILE_DIR ?? ".local/cbs-browser-profile";
  const eventLogPath = process.env.EVENT_LOG;
  const session = await openCBSSession(profileDir);
  try {
    await openAllowlistedCbsPage(session.page, selectors.draftRoomUrlPattern);
    await waitForManualLogin(
      "Click Draft Room even if it opens a new window (not Draft Central / Draft Research). Then press Enter...\n"
    );
    const focused = await focusDraftRoomPage(session, selectors.draftRoomUrlPattern);
    console.log(`Open windows (${focused.urls.length}):`);
    for (const openUrl of focused.urls) {
      console.log(`  ${openUrl}`);
    }
    console.log(`Using: ${focused.page.url()}`);
    if (!looksLikeCbsDraftRoom(focused.page.url())) {
      throw new Error(
        "Monitor did not find the live Draft Room popup. Open Draft → Draft Room and leave that window open."
      );
    }
    const reader = new CBSReader(focused.page, selectors, league);
    const seenPicks = new Set<number>();
    const projectedTurns = new Set<number>();
    console.log("Monitor mode: no clicks will be performed. Ctrl+C to stop.");

    for (;;) {
      const snapshot = await reader.readLiveSnapshot(players);
      console.log(
        `LOOK-ONLY  PICK ${snapshot.control.currentOverallPick ?? "?"} — ${formatOnClockStatus(
          snapshot.control.teamOnClock,
          snapshot.control.isUserTurn
        )} — ${formatClockSeconds(snapshot.control.clockSecondsRemaining)}`
      );
      const latest = snapshot.results.slice(-5);
      for (const result of latest) {
        console.log(`  ${result.overallPick}. ${result.fantasyTeam} — ${result.playerName}`);
      }
      for (const conflict of snapshot.conflicts) {
        console.log(`  CONFLICT: ${conflict}`);
      }

      if (eventLogPath) {
        const resync = resyncFromDraftResults([], snapshot.results, players, snapshot.capturedAt);
        for (const event of resync.events) {
          if (seenPicks.has(event.overallPick)) continue;
          appendEvent(eventLogPath, {
            type: "draft_pick_seen",
            overallPick: event.overallPick,
            team: event.fantasyTeam,
            playerId: event.playerId,
            playerName: event.playerName,
            position: event.position
          });
          seenPicks.add(event.overallPick);
        }
      }

      const projectTurn = shouldProjectForTurn(
        showProjection,
        snapshot.control.isUserTurn,
        snapshot.control.currentOverallPick,
        projectedTurns
      );
      if (projectTurn != null) {
        const draftState = await reader.readDraftState(players, {
          recentPickWindow: strategy.recentPickWindow
        });
        const projected = await predictNextPicks({
          players,
          state: draftState,
          league,
          strategy,
          useAI,
          rosterGrid,
          keepers
        });
        console.log(formatProjection(projected));
        projectedTurns.add(projectTurn);
        if (eventLogPath && projected.projectedPicks.length > 0) {
          appendEvent(eventLogPath, {
            type: "projection",
            overallPick: projected.currentOverallPick,
            horizon: projected.horizon,
            source: projected.source,
            picks: projected.projectedPicks.map((pick) => ({
              playerId: pick.playerId,
              playerName: pick.playerName,
              position: pick.position,
              expectedOverallPick: pick.expectedOverallPick,
              confidence: pick.confidence
            })),
            ...(projected.fallbackReason ? { fallbackReason: projected.fallbackReason } : {})
          });
        }
      }

      await focused.page.waitForTimeout(2000);
    }
  } finally {
    await session.context.close();
  }
}
