import type { Page } from "playwright";
import { loadLeagueConfig, loadStrategyConfig } from "../config/load.js";
import { loadSportslineWorkbook } from "../data/sportsline.js";
import { recommendTurn, shouldRecommendForTurn } from "../engine/recommend.js";
import { applyLiveTurnIdentity } from "../engine/state.js";
import { appendEvent } from "../state/eventLog.js";
import {
  isAllInTheFamilyHost,
  isAllowedCbsUrl,
  isCbsMockDraftRoom
} from "./allowlist.js";
import { persistMockDraftStartUrl, resolveMockDraftStartUrl } from "./mockStartUrl.js";
import { CbsError } from "./errors.js";
import { CBSExecutor } from "./executor.js";
import { clickLocatorBlock } from "./executionGates.js";
import { probeSelector } from "./locators.js";
import { applyMockRoomFacts } from "./roomFacts.js";
import { CBSReader } from "./reader.js";
import {
  assertLiveSelectorConfig,
  loadSelectorConfig,
  requiredReadSelectors,
  resolveMockSelectorConfigPath,
  type SelectorConfig
} from "./selectors.js";
import {
  closeSession,
  openAllowlistedUrl,
  openCBSSession,
  resolveCbsBrowserProfileDir,
  waitForManualLogin,
  waitForPublicMockDraftRoom
} from "./session.js";

const STARTUP_READ_FIELDS = ["currentPick", "teamOnClock", "youAreUpIndicator"] as const;

async function waitUntilReadWidgetsResolve(page: Page, selectors: SelectorConfig): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const unresolved: string[] = [];
    for (const field of STARTUP_READ_FIELDS) {
      const probe = await probeSelector(page, field, selectors.selectors[field]);
      if (!probe.resolved) unresolved.push(field);
    }
    if (unresolved.length === 0) return;
    await page.waitForTimeout(2000);
  }
  throw new Error(
    "Required CBS read locators missed the mock room. Run `npm run cbs:diagnose-mock` in this room. Do not guess selectors."
  );
}

async function readPageHaystack(page: Page): Promise<string> {
  return (await page.evaluate(
    `(() => (document.body ? document.body.innerText || "" : "").replace(/\\s+/g, " "))()`
  )) as string;
}

export async function runCbsMockConfirm(options: { useAI?: boolean } = {}): Promise<void> {
  const leaguePath = process.env.CBS_MOCK_CONFIRM_LEAGUE_CONFIG ?? "config/league.mock.confirm.json";
  const selectorPath = resolveMockSelectorConfigPath();
  const league = loadLeagueConfig(leaguePath);
  const strategy = loadStrategyConfig(process.env.STRATEGY_CONFIG ?? "config/strategy.current.json");
  const selectors = loadSelectorConfig(selectorPath);
  const players = loadSportslineWorkbook(
    process.env.SPORTSLINE_XLSX ?? "data/reference/cheatsheet_cbsppr12.xlsx"
  );

  try {
    assertLiveSelectorConfig(selectors);
    if (requiredReadSelectors(selectors).length > 0) {
      throw new Error("CBS read selectors are not configured.");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error("Run `npm run cbs:diagnose-mock` first. Do not guess selectors.");
    process.exitCode = 2;
    return;
  }

  if (league.executionMode !== "confirm" || !league.cbsExecutionEnabled) {
    console.error("Mock confirm requires executionMode=confirm and cbsExecutionEnabled=true on the mock config.");
    process.exitCode = 2;
    return;
  }
  if (league.keepers.length > 0) {
    console.error("Mock confirm refuses a keeper list. Use config/league.mock.confirm.json.");
    process.exitCode = 2;
    return;
  }
  if (selectors.draftRoomUrlPattern.includes("allfam.football.cbssports.com")) {
    console.error("Mock confirm refuses All in the Family selector config.");
    process.exitCode = 2;
    return;
  }

  const clickBlock = clickLocatorBlock(selectors);
  if (clickBlock) {
    console.error(clickBlock.message);
    console.error("The command will still open the mock lobby so you can capture locators, but it will not click Draft.");
  }

  const profileDir = resolveCbsBrowserProfileDir("mock");
  const startUrl = resolveMockDraftStartUrl();
  if (!isAllowedCbsUrl(startUrl)) {
    console.error(`Refusing non-CBS start URL: ${startUrl}`);
    process.exitCode = 2;
    return;
  }

  const session = await openCBSSession(profileDir);
  try {
    await openAllowlistedUrl(session.page, startUrl);
    console.log("MOCK CONFIRM — public CBS mock only. All in the Family is refused.");
    console.log(`Mock start URL: ${startUrl}`);
    console.log("Log in if needed, then click Join Now yourself. Waiting for that room...");
    const focused = await waitForPublicMockDraftRoom(session);
    if (isAllInTheFamilyHost(focused.page.url()) || !isCbsMockDraftRoom(focused.page.url())) {
      throw new Error("Mock confirm did not land in a public CBS mock draft room.");
    }
    persistMockDraftStartUrl(focused.page.url());
    await waitUntilReadWidgetsResolve(focused.page, selectors);
    console.log(`Using: ${focused.page.url()}`);
    if (clickBlock) {
      console.log("CLICKS DISABLED until search/draft locators are captured from this room while YOU ARE UP.");
    } else {
      console.log("When you are up, this command will recommend a player, wait for Enter, click once, and verify the result.");
    }

    const eventLogPath = process.env.EVENT_LOG;
    const reader = new CBSReader(focused.page, selectors, league);
    const executor = new CBSExecutor(focused.page, selectors, league, strategy, reader, eventLogPath);
    let liveLeague = league;
    const recommendedTurns = new Set<number>();

    for (;;) {
      if (isAllInTheFamilyHost(focused.page.url())) {
        throw new Error("Mock confirm saw the All in the Family host and stopped.");
      }
      let snapshot;
      try {
        snapshot = await reader.readLiveSnapshot(players);
      } catch (error) {
        if (
          error instanceof CbsError &&
          (error.kind === "selector_unresolved" || error.kind === "parse_failed")
        ) {
          console.log(`Waiting for draft widgets... ${error.message}`);
          await focused.page.waitForTimeout(2000);
          continue;
        }
        throw error;
      }

      const haystack = await readPageHaystack(focused.page);
      const overlay = applyMockRoomFacts(liveLeague, {
        draftOrder: snapshot.control.draftOrder,
        haystack
      });
      liveLeague = applyLiveTurnIdentity(overlay.league, {
        youAreUp: snapshot.control.youAreUp,
        teamOnClock: snapshot.control.teamOnClock,
        currentOverallPick: snapshot.control.currentOverallPick
      });
      reader.updateLeague(liveLeague);
      executor.updateLeague(liveLeague);
      for (const conflict of [...overlay.conflicts, ...snapshot.conflicts]) {
        console.log(`  CONFLICT: ${conflict}`);
      }
      console.log(
        `MOCK CONFIRM  PICK ${snapshot.control.currentOverallPick ?? "?"} — ${snapshot.control.teamOnClock ?? "unknown"}${snapshot.control.isUserTurn ? "  [our turn]" : ""}  ${liveLeague.teamCount} ${liveLeague.scoringFormat}`
      );

      const turn = shouldRecommendForTurn(
        snapshot.control.isUserTurn,
        snapshot.control.currentOverallPick,
        recommendedTurns
      );
      if (turn != null) {
        if (eventLogPath) appendEvent(eventLogPath, { type: "our_turn", overallPick: turn });
        const state = await reader.readDraftState(players, { recentPickWindow: strategy.recentPickWindow });
        const ranked = await recommendTurn({
          players,
          state,
          league: liveLeague,
          strategy,
          useAI: options.useAI ?? true
        });
        console.log(ranked.output);
        const selected =
          ranked.ranked.find((candidate) => candidate.player.id === ranked.decision.selectedCandidateId) ??
          ranked.ranked[0]!;
        const locators = clickLocatorBlock(selectors);
        if (locators) {
          console.error(locators.message);
          recommendedTurns.add(turn);
        } else {
          await waitForManualLogin(
            `Press Enter to draft ${selected.player.name} in this public mock (not All in the Family). Ctrl+C to stop.\n`
          );
          await executor.executeConfirmedPick(selected, turn);
          console.log(`VERIFIED mock pick ${turn}: ${selected.player.name}`);
          recommendedTurns.add(turn);
        }
      }

      if (executor.isDisabled) {
        console.error(`Executor disabled: ${executor.disableReasonText}`);
        process.exitCode = 2;
        return;
      }
      await focused.page.waitForTimeout(2000);
    }
  } finally {
    await closeSession(session);
  }
}
