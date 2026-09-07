import { noCandidates } from "../domain/errors.js";
import type {
  CandidateScore,
  DraftState,
  LeagueConfig,
  LivePlayer,
  StrategyConfig
} from "../domain/types.js";
import { isEligibleCandidate, rosterCount } from "./eligibility.js";
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
  const starterFills = eligible.filter((player) =>
    rosterCount(state, player.position) < league.lineup[player.position]
  );
  const usefulDepth = eligible.filter((player) =>
    league.lineup[player.position] > 0 && (
      player.position === "RB" || player.position === "WR" ||
      ((player.position === "QB" || player.position === "TE") &&
        rosterCount(state, player.position) < league.lineup[player.position] + 1)
    )
  );
  const preferred = starterFills.length > 0 ? starterFills : usefulDepth.length > 0 ? usefulDepth : eligible;
  const preferredIds = new Set(preferred.map((player) => player.id));
  const priorityNote = starterFills.length > 0
    ? `Roster priority: fill ${[...new Set(starterFills.map((player) => player.position))].join("/")} starter openings before bench depth.`
    : usefulDepth.length > 0
      ? "Roster priority: RB/WR depth or a first QB/TE backup before redundant backups; no eligible starter fills remain."
      : "Roster priority: no eligible starter fills or preferred depth remain; ranking the remaining eligible players.";

  // Score against the full eligible pool so roster priority does not distort SportsLine tier/scarcity signals.
  return scoreCandidates(eligible, state, league, strategy)
    .filter((candidate) => preferredIds.has(candidate.player.id))
    .slice(0, strategy.candidateShortlistSize)
    .map((candidate) => ({ ...candidate, notes: [...candidate.notes, priorityNote] }));
}
