import type { DraftState, LeagueConfig, LivePlayer, Position, StrategyConfig } from "../domain/types.js";

export function rosterCount(state: DraftState, position: Position): number {
  return state.roster.players.filter((p) => p.position === position).length;
}

export function wouldExceedRosterMaximum(
  player: LivePlayer,
  state: DraftState,
  league: LeagueConfig
): boolean {
  const max = league.rosterMaximums[player.position];
  if (max === undefined) return false;
  return rosterCount(state, player.position) >= max;
}

export function isKdstTooEarly(
  player: LivePlayer,
  state: DraftState,
  strategy: StrategyConfig
): boolean {
  if (player.position !== "K" && player.position !== "DST") return false;
  return state.currentOverallPick < strategy.kDstEligibleAfterOverallPick;
}

export function isEligibleCandidate(
  player: LivePlayer,
  state: DraftState,
  league: LeagueConfig,
  strategy: StrategyConfig
): boolean {
  if (!player.available) return false;
  if (!state.availablePlayerIds.has(player.id)) return false;
  if (wouldExceedRosterMaximum(player, state, league)) return false;
  if (isKdstTooEarly(player, state, strategy)) return false;
  return true;
}
