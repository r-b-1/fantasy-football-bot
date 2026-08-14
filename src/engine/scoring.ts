import type {
  CandidateComponentScores,
  CandidateScore,
  DraftState,
  LeagueConfig,
  LivePlayer,
  Position,
  StrategyConfig
} from "../domain/types.js";
import { rosterCount } from "./eligibility.js";
import { explainCandidate } from "./explain.js";

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

export function computeAdpValue(currentPick: number, adp: number | null): number {
  if (adp === null) return 50;
  const delta = currentPick - adp;
  return clamp(50 + 50 * Math.tanh(delta / 24));
}

export function computeRosterNeed(
  position: Position,
  state: DraftState,
  league: LeagueConfig,
  strategy: StrategyConfig
): number {
  const have = rosterCount(state, position);
  const starterTarget = league.lineup[position] ?? 0;

  if (position === "K" || position === "DST") {
    if (state.currentOverallPick < strategy.kDstEligibleAfterOverallPick) return 8;
    if (have < starterTarget) return 75;
    return 10;
  }

  if (starterTarget === 0) return 0;
  if (have < starterTarget) {
    const missing = starterTarget - have;
    const base = 70 + Math.min(25, missing * 10);
    if (position === "RB" || position === "WR") return clamp(base + 5);
    if (position === "QB" && league.teamCount >= 16) return clamp(base + 3);
    return clamp(base);
  }

  const extras = have - starterTarget;
  if (position === "RB") return clamp(58 - extras * 12);
  if (position === "WR") return clamp(55 - extras * 12);
  if (position === "TE") return extras === 0 ? 28 : 15;
  if (position === "QB") return extras === 0 ? 20 : 10;
  return 8;
}

export function computeNextPickRisk(
  currentPick: number,
  nextUserPick: number | null,
  adp: number | null,
  positionalRunCount = 0
): number {
  if (nextUserPick === null) return 50;
  const gap = nextUserPick - currentPick;
  if (gap <= 0) return 100;

  const runBoost = Math.min(15, Math.max(0, positionalRunCount) * 4);
  if (adp === null) return clamp(45 + gap * 1.2 + runBoost);

  const survivalMargin = nextUserPick - adp;
  const base = 50 + 50 * Math.tanh(survivalMargin / 18);
  return clamp(base + runBoost);
}

export function computeTierCliff(player: LivePlayer, available: LivePlayer[]): number {
  const peers = available
    .filter((p) => p.position === player.position && p.id !== player.id)
    .sort((a, b) => b.sportslineRating - a.sportslineRating)
    .slice(0, 5)
    .map((p) => p.sportslineRating);

  if (peers.length === 0) return 100;
  return clamp(50 + (player.sportslineRating - median(peers)) * 4);
}

export function computeScarcity(
  player: LivePlayer,
  available: LivePlayer[],
  state: DraftState,
  league: LeagueConfig
): number {
  const samePosition = available
    .filter((p) => p.position === player.position)
    .sort((a, b) => b.sportslineRating - a.sportslineRating);
  const rank = samePosition.findIndex((p) => p.id === player.id);
  if (rank < 0) return 0;

  const totalStarterDemand = league.teamCount * (league.lineup[player.position] ?? 0);
  if (totalStarterDemand === 0) return 10;

  const alreadyTaken =
    state.draftEvents.filter((event) => event.position === player.position).length +
    state.roster.players.filter((p) => p.position === player.position && p.source === "keeper").length;
  const remainingStarterSlots = Math.max(0, totalStarterDemand - alreadyTaken);
  const viableRemaining = samePosition.filter((p) => p.sportslineRating >= 40).length;
  const depthPressure = remainingStarterSlots / Math.max(1, viableRemaining);
  const eliteBonus = clamp(((samePosition.length - rank) / Math.max(1, samePosition.length)) * 35);
  const positionBoost =
    player.position === "RB"
      ? 8
      : player.position === "WR"
        ? 5
        : player.position === "QB" && league.teamCount >= 16
          ? 5
          : 0;
  return clamp(40 + depthPressure * 15 + eliteBonus + positionBoost);
}

export function computeVor(
  player: LivePlayer,
  available: LivePlayer[],
  state: DraftState,
  league: LeagueConfig
): number | undefined {
  if (player.projectedPoints == null) return undefined;
  const same = available
    .filter((p) => p.position === player.position && p.projectedPoints != null)
    .sort((a, b) => (b.projectedPoints ?? 0) - (a.projectedPoints ?? 0));
  if (same.length === 0) return undefined;

  const alreadyTaken =
    state.draftEvents.filter((event) => event.position === player.position).length +
    state.roster.players.filter((p) => p.position === player.position).length;
  const replacementIndex = Math.max(
    0,
    league.teamCount * (league.lineup[player.position] ?? 0) - alreadyTaken
  );
  const replacement = same[Math.min(replacementIndex, same.length - 1)];
  if (replacement?.projectedPoints == null) return undefined;
  const vor = player.projectedPoints - replacement.projectedPoints;
  return clamp(50 + 50 * Math.tanh(vor / 40));
}

function earlyPositionPenalty(
  player: LivePlayer,
  state: DraftState,
  strategy: StrategyConfig
): number {
  if (state.currentOverallPick >= strategy.kDstEligibleAfterOverallPick) return 0;
  return strategy.earlyRoundPositionPenalties[player.position] ?? 0;
}

function byeOverlapPenalty(player: LivePlayer, state: DraftState, strategy: StrategyConfig): number {
  if (player.byeWeek == null || strategy.byeOverlapPenalty <= 0) return 0;
  const sameBye = state.roster.players.filter((p) => p.byeWeek === player.byeWeek).length;
  if (sameBye < 2) return 0;
  return Math.min(8, strategy.byeOverlapPenalty * (sameBye - 1));
}

export function scoreCandidates(
  available: LivePlayer[],
  state: DraftState,
  league: LeagueConfig,
  strategy: StrategyConfig
): CandidateScore[] {
  const pool = available.filter((p) => p.available && state.availablePlayerIds.has(p.id));
  const hasProjections = pool.some((p) => p.projectedPoints != null);

  return pool
    .map((player): CandidateScore => {
      const components: CandidateComponentScores = {
        sportslineRating: clamp(player.sportslineRating),
        adpValue: computeAdpValue(state.currentOverallPick, player.adp),
        rosterNeed: computeRosterNeed(player.position, state, league, strategy),
        scarcity: computeScarcity(player, pool, state, league),
        nextPickRisk: computeNextPickRisk(
          state.currentOverallPick,
          state.nextUserOverallPick,
          player.adp,
          state.recentPositionCounts[player.position] ?? 0
        ),
        tierCliff: computeTierCliff(player, pool),
        penalties:
          earlyPositionPenalty(player, state, strategy) + byeOverlapPenalty(player, state, strategy)
      };
      if (hasProjections) {
        components.vor = computeVor(player, pool, state, league);
      }

      const weighted =
        strategy.weights.sportslineRating * components.sportslineRating +
        strategy.weights.adpValue * components.adpValue +
        strategy.weights.rosterNeed * components.rosterNeed +
        strategy.weights.scarcity * components.scarcity +
        strategy.weights.nextPickRisk * components.nextPickRisk +
        strategy.weights.tierCliff * components.tierCliff +
        strategy.vorWeight * (components.vor ?? 0) -
        components.penalties;

      const scored = {
        player,
        score: Math.round(weighted * 100) / 100,
        components
      };

      return {
        ...scored,
        notes: explainCandidate(scored, state, league, strategy)
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.player.sportslineRating - a.player.sportslineRating ||
        a.player.name.localeCompare(b.player.name)
    );
}
