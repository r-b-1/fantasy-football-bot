import { noCandidates } from "../domain/errors.js";
import type {
  CandidateScore,
  DraftState,
  LeagueConfig,
  LivePlayer,
  StrategyConfig
} from "../domain/types.js";
import { isEligibleCandidate } from "./eligibility.js";
import { scoreCandidates } from "./scoring.js";

export function eligiblePlayers(
  players: LivePlayer[],
  state: DraftState,
  league: LeagueConfig,
  strategy: StrategyConfig
): LivePlayer[] {
  return players.filter((player) => isEligibleCandidate(player, state, league, strategy));
}

export function generateShortlist(
  players: LivePlayer[],
  state: DraftState,
  league: LeagueConfig,
  strategy: StrategyConfig
): CandidateScore[] {
  const eligible = eligiblePlayers(players, state, league, strategy);
  if (eligible.length === 0) throw noCandidates();
  return scoreCandidates(eligible, state, league, strategy).slice(
    0,
    strategy.candidateShortlistSize
  );
}
