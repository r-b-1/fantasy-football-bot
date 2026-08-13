import type {
  CandidateScore,
  DraftState,
  LeagueConfig,
  LivePlayer,
  Position,
  StrategyConfig
} from "../domain/types.js";

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

export function computeAdpValue(currentPick: number, adp: number | null): number {
  if (adp === null) return 50;
  const delta = currentPick - adp;
  return clamp(50 + 50 * Math.tanh(delta / 24));
}

function rosterCount(state: DraftState, position: Position): number {
  return state.roster.players.filter((p) => p.position === position).length;
}

export function computeRosterNeed(
  position: Position,
  state: DraftState,
  league: LeagueConfig
): number {
  const have = rosterCount(state, position);
  const starterTarget = league.lineup[position] ?? 0;

  if (starterTarget === 0) return 0;
  if (have < starterTarget) {
    const missing = starterTarget - have;
    const base = 70 + Math.min(25, missing * 10);
    if (position === "RB" || position === "WR") return clamp(base + 5);
    if (position === "QB" && league.teamCount >= 16) return clamp(base + 3);
    return clamp(base);
  }

  // Bench value remains meaningful for RB/WR in a deep league.
  if (position === "RB") return 58;
  if (position === "WR") return 55;
  if (position === "TE") return have === starterTarget ? 28 : 15;
  if (position === "QB") return have === starterTarget ? 20 : 10;
  return 8;
}

export function computeNextPickRisk(
  currentPick: number,
  nextUserPick: number | null,
  adp: number | null
): number {
  if (nextUserPick === null) return 50;
  const gap = nextUserPick - currentPick;
  if (gap <= 0) return 100;
  if (adp === null) return clamp(45 + gap * 1.2);

  // Heuristic probability-like pressure: how far the next pick is beyond market ADP.
  const survivalMargin = nextUserPick - adp;
  return clamp(50 + 50 * Math.tanh(survivalMargin / 18));
}

export function computeTierCliff(player: LivePlayer, available: LivePlayer[]): number {
  const peers = available
    .filter((p) => p.position === player.position && p.id !== player.id)
    .sort((a, b) => b.sportslineRating - a.sportslineRating)
    .slice(0, 5)
    .map((p) => p.sportslineRating);

  if (peers.length === 0) return 100;
  const median = [...peers].sort((a, b) => a - b)[Math.floor(peers.length / 2)]!;
  return clamp(50 + (player.sportslineRating - median) * 4);
}

export function computeScarcity(player: LivePlayer, available: LivePlayer[], league: LeagueConfig): number {
  const samePosition = available
    .filter((p) => p.position === player.position)
    .sort((a, b) => b.sportslineRating - a.sportslineRating);
  const rank = samePosition.findIndex((p) => p.id === player.id);
  if (rank < 0) return 0;

  const totalStarterDemand = league.teamCount * (league.lineup[player.position] ?? 0);
  if (totalStarterDemand === 0) return 10;

  const depthPressure = totalStarterDemand / Math.max(1, samePosition.length);
  const eliteBonus = clamp((samePosition.length - rank) / Math.max(1, samePosition.length) * 35);
  const positionBoost = player.position === "RB" ? 8 : player.position === "WR" ? 5 : player.position === "QB" && league.teamCount >= 16 ? 5 : 0;
  return clamp(40 + depthPressure * 15 + eliteBonus + positionBoost);
}

function earlyPositionPenalty(player: LivePlayer, state: DraftState, strategy: StrategyConfig): number {
  if (state.currentOverallPick > 130) return 0;
  return strategy.earlyRoundPositionPenalties[player.position] ?? 0;
}

export function scoreCandidates(
  available: LivePlayer[],
  state: DraftState,
  league: LeagueConfig,
  strategy: StrategyConfig
): CandidateScore[] {
  return available
    .filter((p) => p.available)
    .map((player): CandidateScore => {
      const components = {
        sportslineRating: clamp(player.sportslineRating),
        adpValue: computeAdpValue(state.currentOverallPick, player.adp),
        rosterNeed: computeRosterNeed(player.position, state, league),
        scarcity: computeScarcity(player, available, league),
        nextPickRisk: computeNextPickRisk(
          state.currentOverallPick,
          state.nextUserOverallPick,
          player.adp
        ),
        tierCliff: computeTierCliff(player, available),
        penalties: earlyPositionPenalty(player, state, strategy)
      };

      const weighted =
        strategy.weights.sportslineRating * components.sportslineRating +
        strategy.weights.adpValue * components.adpValue +
        strategy.weights.rosterNeed * components.rosterNeed +
        strategy.weights.scarcity * components.scarcity +
        strategy.weights.nextPickRisk * components.nextPickRisk +
        strategy.weights.tierCliff * components.tierCliff -
        components.penalties;

      return {
        player,
        score: Math.round(weighted * 100) / 100,
        components,
        notes: []
      };
    })
    .sort((a, b) => b.score - a.score || a.player.name.localeCompare(b.player.name));
}
