import type { Page } from "playwright";
import { loadLeagueConfig, loadStrategyConfig } from "../config/load.js";
import { loadRosterGrid, type RosterGrid } from "../data/rosterGrid.js";
import { resolveProjectionKeepers, type LeagueKeeper } from "../data/leagueKeepers.js";
import { loadSportslineWorkbook } from "../data/sportsline.js";
import type { LeagueConfig, SportslinePlayer, StrategyConfig } from "../domain/types.js";
import { applyLiveTurnIdentity, toLivePlayers } from "../engine/state.js";
import { recommendTurn, shouldRecommendForTurn } from "../engine/recommend.js";
import { shouldProjectForTurn } from "../engine/predict.js";
import { predictNextPicks } from "../ai/predict.js";
import { formatProjection } from "../cli/format.js";
import { draftStateForOnClockTeam } from "../engine/onClockPreview.js";
import { appendEvent } from "../state/eventLog.js";
import {
  isAllInTheFamilyHost,
  isAllowedCbsUrl,
  leagueStartUrl,
  looksLikeCbsDraftRoom
} from "./allowlist.js";
import { CbsError } from "./errors.js";
import { EngineError } from "../domain/errors.js";
import { probeSelector } from "./locators.js";
import { formatClockSeconds, formatOnClockStatus } from "./parse.js";
import { CBSReader } from "./reader.js";
import { resyncFromDraftResults } from "./resync.js";
import {
  assertLiveSelectorConfig,
  loadSelectorConfig,
  requiredReadSelectors,
  resolveSelectorConfigPath,
  type SelectorConfig
} from "./selectors.js";
import { resolveMockDraftStartUrl } from "./mockStartUrl.js";
import { openLoggedInDraftRoom, resolveCbsBrowserProfileDir } from "./session.js";

export interface LiveRecommendOptions {
  useAI?: boolean;
  startUrl?: string;
  leaguePath?: string;
  refuseLeagueRoom?: boolean;
  prompt?: string;
  preferredPattern?: string;
  showProjection?: boolean;
  profileDir?: string;
}

function mockJoinPrompt(): string {
  return [
    "Log into CBS in the Chrome window if needed.",
    "Join a 12-team PPR Standard mock yourself (Join Now). This program will not click Join, Draft, or Autopilot.",
    "Do not open or use the All in the Family draft room.",
    "When the mock draft room is open (pick/clock visible), press Enter here.\n"
  ].join("\n");
}

function leagueRecommendPrompt(): string {
  return [
    "Click Draft Room even if it opens a new window (not Draft Central / Draft Research).",
    "This is recommend mode: no clicks will be performed.",
    "When pick/clock are visible, press Enter here.\n"
  ].join(" ");
}

const STARTUP_READ_FIELDS = [
  "currentPick",
  "teamOnClock",
  "youAreUpIndicator"
] as const;

async function unresolvedStartupSelectors(page: Page, selectors: SelectorConfig): Promise<string[]> {
  const missing = requiredReadSelectors(selectors);
  if (missing.length > 0) return missing;
  const unresolved: string[] = [];
  for (const field of STARTUP_READ_FIELDS) {
    const probe = await probeSelector(page, field, selectors.selectors[field]);
    if (!probe.resolved) unresolved.push(field);
  }
  return unresolved;
}

async function waitUntilSelectorsResolve(page: Page, selectors: SelectorConfig): Promise<void> {
  const deadline = Date.now() + 60_000;
  let last = await unresolvedStartupSelectors(page, selectors);
  while (last.length > 0 && Date.now() < deadline) {
    await page.waitForTimeout(2000);
    last = await unresolvedStartupSelectors(page, selectors);
  }
  if (last.length > 0) {
    throw new Error(
      `Required CBS read locators missed the page (${last.join(", ")}). Run \`npm run cbs:diagnose\` or \`npm run cbs:diagnose-mock\` in this room. Do not guess selectors.`
    );
  }
}

export async function runCbsRecommend(options: LiveRecommendOptions = {}): Promise<void> {
  const selectorPath = resolveSelectorConfigPath();
  const leaguePath =
    options.leaguePath ?? process.env.LEAGUE_CONFIG ?? "config/league.current.json";
  const league = loadLeagueConfig(leaguePath);
  const strategy = loadStrategyConfig(process.env.STRATEGY_CONFIG ?? "config/strategy.current.json");
  console.log(`Selector config: ${selectorPath}`);
  const selectors = loadSelectorConfig(selectorPath);
  const players = loadSportslineWorkbook(
    process.env.SPORTSLINE_XLSX ?? "data/reference/cheatsheet_cbsppr12.xlsx"
  );
  const useAI = options.useAI ?? true;
  const showProjection = options.showProjection ?? !process.argv.includes("--no-projection");
  const rosterGrid = league.rosterGridPath ? loadRosterGrid(league.rosterGridPath) : undefined;
  const keepers = resolveProjectionKeepers(league);

  try {
    assertLiveSelectorConfig(selectors);
    if (requiredReadSelectors(selectors).length > 0) {
      throw new Error("CBS read selectors are not configured.");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error("Run `npm run cbs:diagnose` in the logged-in draft room first. Do not guess selectors.");
    process.exitCode = 2;
    return;
  }

  if (league.cbsExecutionEnabled) {
    console.error("Recommend/mock mode refuses a config with cbsExecutionEnabled=true.");
    process.exitCode = 2;
    return;
  }
  if (league.executionMode === "autopilot" || league.executionMode === "confirm") {
    console.error(`Recommend/mock mode refuses executionMode=${league.executionMode}. Use recommend.`);
    process.exitCode = 2;
    return;
  }

  const startUrl =
    options.startUrl ??
    process.env.CBS_DRAFT_START_URL ??
    leagueStartUrl(selectors.draftRoomUrlPattern);
  if (!isAllowedCbsUrl(startUrl)) {
    console.error(`Refusing non-CBS start URL: ${startUrl}`);
    process.exitCode = 2;
    return;
  }

  const profileDir = options.profileDir ?? resolveCbsBrowserProfileDir("live");
  const eventLogPath = process.env.EVENT_LOG;
  const refuseLeagueRoom = options.refuseLeagueRoom ?? false;
  const { session, focused } = await openLoggedInDraftRoom({
    profileDir,
    startUrl,
    preferredPattern: options.preferredPattern ?? (refuseLeagueRoom ? undefined : selectors.draftRoomUrlPattern),
    prompt: options.prompt ?? (refuseLeagueRoom ? mockJoinPrompt() : leagueRecommendPrompt())
  });

  try {
    console.log(`Open windows (${focused.urls.length}):`);
    for (const openUrl of focused.urls) console.log(`  ${openUrl}`);
    console.log(`Using: ${focused.page.url()}`);

    if (refuseLeagueRoom && isAllInTheFamilyHost(focused.page.url())) {
      throw new Error(
        "Mock recommend refused the real All in the Family room. Join a public CBS mock instead."
      );
    }
    if (!looksLikeCbsDraftRoom(focused.page.url())) {
      throw new Error(
        refuseLeagueRoom
          ? "Mock recommend did not find a CBS mock draft room. Join a mock, leave that window open, then press Enter."
          : "Recommend did not find the live Draft Room popup. Open Draft → Draft Room and leave that window open."
      );
    }

    await waitUntilSelectorsResolve(focused.page, selectors);
    console.log(
      `RECOMMEND MODE — no clicks. ${useAI ? "OpenAI will rank the shortlist when a key is present." : "Deterministic engine only."}`
    );
    console.log(
      "While another team is on the clock, you'll see their likely pick in the same banner you'll get on your turn."
    );
    console.log("Ctrl+C to stop. You must make the pick in CBS yourself.");

    await runRecommendPollLoop({
      page: focused.page,
      selectors,
      league,
      strategy,
      players,
      useAI,
      showProjection,
      rosterGrid,
      keepers,
      eventLogPath,
      refuseLeagueRoom
    });
  } finally {
    await session.context.close();
  }
}

export async function runCbsMockDraft(options: { useAI?: boolean } = {}): Promise<void> {
  await runCbsRecommend({
    useAI: options.useAI ?? true,
    startUrl: resolveMockDraftStartUrl(),
    leaguePath: process.env.CBS_MOCK_LEAGUE_CONFIG ?? "config/league.mock.json",
    refuseLeagueRoom: true,
    prompt: mockJoinPrompt(),
    profileDir: resolveCbsBrowserProfileDir("mock")
  });
}

export async function runRecommendPollLoop(args: {
  page: Page;
  selectors: SelectorConfig;
  league: LeagueConfig;
  strategy: StrategyConfig;
  players: SportslinePlayer[];
  useAI: boolean;
  eventLogPath?: string;
  refuseLeagueRoom?: boolean;
  intervalMs?: number;
  untilPick?: number;
  showProjection?: boolean;
  rosterGrid?: RosterGrid;
  keepers?: LeagueKeeper[];
  onRecommendation?: (overallPick: number) => void;
  onProjection?: (overallPick: number) => void;
  onOnClockPreview?: (info: { overallPick: number; teamName: string; output: string }) => void;
}): Promise<void> {
  const reader = new CBSReader(args.page, args.selectors, args.league);
  let league = args.league;
  const seenPicks = new Set<number>();
  const recommendedTurns = new Set<number>();
  const projectedTurns = new Set<number>();
  const showProjection = args.showProjection ?? true;
  const livePlayers = toLivePlayers(args.players, new Set());

  for (;;) {
    if (args.refuseLeagueRoom && isAllInTheFamilyHost(args.page.url())) {
      throw new Error("Mock recommend saw the All in the Family host and stopped.");
    }

    let snapshot;
    try {
      snapshot = await reader.readLiveSnapshot(args.players);
    } catch (error) {
      if (
        error instanceof CbsError &&
        (error.kind === "selector_unresolved" || error.kind === "parse_failed")
      ) {
        console.log(`Waiting for draft widgets... ${error.message}`);
        await args.page.waitForTimeout(args.intervalMs ?? 2000);
        continue;
      }
      throw error;
    }

    const locked = applyLiveTurnIdentity(league, {
      youAreUp: snapshot.control.youAreUp,
      teamOnClock: snapshot.control.teamOnClock,
      currentOverallPick: snapshot.control.currentOverallPick
    });
    if (locked.userTeamName !== league.userTeamName || locked.draftSlot !== league.draftSlot) {
      console.log(
        `Locked live identity: team="${locked.userTeamName}" slot=${locked.draftSlot} picks=${locked.knownOverallPicks.slice(0, 6).join(",")}${locked.knownOverallPicks.length > 6 ? ",..." : ""}`
      );
      league = locked;
      reader.updateLeague(league);
    }

    console.log(
      `RECOMMEND  PICK ${snapshot.control.currentOverallPick ?? "?"} — ${formatOnClockStatus(
        snapshot.control.teamOnClock,
        snapshot.control.isUserTurn
      )} — ${formatClockSeconds(snapshot.control.clockSecondsRemaining)}`
    );
    for (const result of snapshot.results.slice(-5)) {
      console.log(`  ${result.overallPick}. ${result.fantasyTeam} — ${result.playerName}`);
    }
    for (const conflict of snapshot.conflicts) {
      console.log(`  CONFLICT: ${conflict}`);
    }

    if (args.eventLogPath) {
      const resync = resyncFromDraftResults([], snapshot.results, args.players, snapshot.capturedAt);
      for (const event of resync.events) {
        if (seenPicks.has(event.overallPick)) continue;
        appendEvent(args.eventLogPath, {
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

    const turn = shouldRecommendForTurn(
      snapshot.control.isUserTurn,
      snapshot.control.currentOverallPick,
      recommendedTurns
    );
    if (turn != null) {
      if (args.eventLogPath) {
        appendEvent(args.eventLogPath, { type: "our_turn", overallPick: turn });
      }
      const state = await reader.readDraftState(args.players, {
        recentPickWindow: args.strategy.recentPickWindow
      });
      const result = await recommendTurn({
        players: args.players,
        state,
        league,
        strategy: args.strategy,
        useAI: args.useAI,
        eventLogPath: args.eventLogPath
      });
      console.log(result.output);
      recommendedTurns.add(turn);
      args.onRecommendation?.(turn);
    } else {
      const projectTurn = shouldProjectForTurn(
        showProjection,
        snapshot.control.isUserTurn,
        snapshot.control.currentOverallPick,
        projectedTurns
      );
      if (projectTurn != null) {
        const state = await reader.readDraftState(args.players, {
          recentPickWindow: args.strategy.recentPickWindow
        });
        const teamOnClock = snapshot.control.teamOnClock;
        if (teamOnClock && !/waiting for start/i.test(teamOnClock)) {
          const previewState = draftStateForOnClockTeam({
            state,
            teamName: teamOnClock,
            league,
            players: args.players,
            keepers: args.keepers,
            rosterGrid: args.rosterGrid
          });
          try {
            const preview = await recommendTurn({
              players: args.players,
              state: previewState,
              league,
              strategy: args.strategy,
              useAI: args.useAI,
              previewForTeam: teamOnClock,
              explain: "top"
            });
            console.log(preview.output);
            args.onOnClockPreview?.({
              overallPick: projectTurn,
              teamName: teamOnClock,
              output: preview.output
            });
          } catch (error) {
            if (error instanceof EngineError && error.kind === "no_candidates") {
              console.log(
                `LIKELY PICK FOR ${teamOnClock} — no eligible candidates from the current pool.`
              );
            } else {
              throw error;
            }
          }
        }
        const projected = await predictNextPicks({
          players: livePlayers,
          state,
          league,
          strategy: args.strategy,
          useAI: false,
          rosterGrid: args.rosterGrid,
          keepers: args.keepers
        });
        console.log(formatProjection(projected));
        projectedTurns.add(projectTurn);
        args.onProjection?.(projectTurn);
        if (args.eventLogPath && projected.projectedPicks.length > 0) {
          appendEvent(args.eventLogPath, {
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
    }

    const current = snapshot.control.currentOverallPick ?? 0;
    if (args.untilPick != null && current >= args.untilPick && !snapshot.control.isUserTurn) {
      return;
    }
    await args.page.waitForTimeout(args.intervalMs ?? 2000);
  }
}
