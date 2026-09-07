import { isAllowedCbsUrl, isAllowedFixtureUrl, isAllInTheFamilyHost, isCbsMockDraftRoom } from "./allowlist.js";
import type { LeagueConfig } from "../domain/types.js";
import type { LiveDraftResult } from "./types.js";
import { playerNamesEquivalent } from "./parse.js";
import type { SelectorConfig } from "./selectors.js";
import { requiredClickSelectors } from "./selectors.js";

export type MockExecutionBlockKind =
  | "fixture"
  | "league_room"
  | "not_mock_room"
  | "execution_disabled"
  | "wrong_mode"
  | "disabled"
  | "duplicate"
  | "not_our_turn"
  | "stale_pick"
  | "unavailable"
  | "clock"
  | "missing_locators";

export interface MockExecutionBlock {
  kind: MockExecutionBlockKind;
  message: string;
}

export function hostExecutionBlock(url: string): MockExecutionBlock | null {
  if (isAllowedFixtureUrl(url) || url.includes("fixture-draft-room")) {
    return { kind: "fixture", message: "CBSExecutor will not act on the local fake room or any non-CBS page." };
  }
  if (isAllInTheFamilyHost(url)) {
    return { kind: "league_room", message: "Mock confirm refused the All in the Family draft room." };
  }
  if (!isAllowedCbsUrl(url) || !isCbsMockDraftRoom(url)) {
    return { kind: "not_mock_room", message: "CBSExecutor only clicks in a public CBS mock draft room." };
  }
  return null;
}

export function configExecutionBlock(league: LeagueConfig): MockExecutionBlock | null {
  if (!league.cbsExecutionEnabled) {
    return { kind: "execution_disabled", message: "CBS execution is disabled in league config." };
  }
  if (league.executionMode !== "autopilot" && league.executionMode !== "confirm") {
    return { kind: "wrong_mode", message: `Execution not allowed in mode ${league.executionMode}` };
  }
  return null;
}

export function clickLocatorBlock(selectors: SelectorConfig): MockExecutionBlock | null {
  const missing = requiredClickSelectors(selectors);
  if (missing.length === 0) return null;
  return {
    kind: "missing_locators",
    message: `Click locators are unset (${missing.join(", ")}). Run \`npm run cbs:diagnose-mock\` while YOU ARE ON THE CLOCK, click a player name so the Draft popup is visible, and save captured locators to config/selectors.local.json. Do not guess selectors.`
  };
}

export function snapshotExecutionBlock(args: {
  isUserTurn: boolean;
  teamOnClock: string | null;
  userTeamName: string;
  currentOverallPick: number | null;
  expectedOverallPick: number;
  clockSecondsRemaining: number | null;
  minimumExecutionClockSeconds: number;
  results: LiveDraftResult[];
  playerName: string;
  completed: ReadonlySet<number>;
  disabledReason: string | null;
}): MockExecutionBlock | null {
  if (args.disabledReason) {
    return { kind: "disabled", message: `Executor disabled after prior failure: ${args.disabledReason}` };
  }
  if (args.completed.has(args.expectedOverallPick)) {
    return {
      kind: "duplicate",
      message: `Already successfully completed mock pick ${args.expectedOverallPick}`
    };
  }
  if (!args.isUserTurn || args.teamOnClock !== args.userTeamName) {
    return { kind: "not_our_turn", message: "Safety gate failed: user team is not on the clock." };
  }
  if (args.currentOverallPick !== args.expectedOverallPick) {
    return {
      kind: "stale_pick",
      message: `Expected pick ${args.expectedOverallPick} but page shows ${args.currentOverallPick}`
    };
  }
  if (
    args.clockSecondsRemaining !== null &&
    args.clockSecondsRemaining < args.minimumExecutionClockSeconds
  ) {
    return { kind: "clock", message: "Safety gate failed: insufficient clock time for verified execution." };
  }
  if (args.results.some((row) => playerNamesEquivalent(row.playerName, args.playerName))) {
    return { kind: "unavailable", message: `${args.playerName} is already drafted` };
  }
  return null;
}
