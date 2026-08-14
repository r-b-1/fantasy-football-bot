import type {
  CandidateComponentScores,
  CandidateScore,
  DraftState,
  LeagueConfig,
  LivePlayer,
  StrategyConfig
} from "../domain/types.js";

export function explainCandidate(
  scored: Omit<CandidateScore, "notes">,
  state: DraftState,
  league: LeagueConfig,
  strategy: StrategyConfig
): string[] {
  const { player, components, score } = scored;
  const weights = strategy.weights;
  const starterHave = state.roster.players.filter((p) => p.position === player.position).length;
  const starterTarget = league.lineup[player.position] ?? 0;
  const adpDelta = player.adp == null ? null : state.currentOverallPick - player.adp;
  const gap =
    state.nextUserOverallPick == null ? null : state.nextUserOverallPick - state.currentOverallPick;
  const plan = strategy.softDraftPlan[String(state.currentOverallPick)];
  const runCount = state.recentPositionCounts[player.position] ?? 0;

  const notes = [
    `total=${score.toFixed(2)}`,
    contribLine("sportslineRating", components.sportslineRating, weights.sportslineRating),
    contribLine(
      "adpValue",
      components.adpValue,
      weights.adpValue,
      adpDelta == null
        ? "ADP unknown; treated as market-neutral"
        : `ADP ${player.adp} vs pick ${state.currentOverallPick} (delta ${adpDelta >= 0 ? "+" : ""}${adpDelta.toFixed(1)})`
    ),
    contribLine(
      "rosterNeed",
      components.rosterNeed,
      weights.rosterNeed,
      `${player.position} rostered ${starterHave}/${starterTarget} starters`
    ),
    contribLine("scarcity", components.scarcity, weights.scarcity, `16-team starter demand for ${player.position}`),
    contribLine(
      "nextPickRisk",
      components.nextPickRisk,
      weights.nextPickRisk,
      gap == null
        ? "no later user pick configured"
        : `${gap} picks until next user pick ${state.nextUserOverallPick}; ${player.position} run count ${runCount}`
    ),
    contribLine(
      "tierCliff",
      components.tierCliff,
      weights.tierCliff,
      "rating vs median of next available same-position players"
    )
  ];

  if (components.vor != null) {
    notes.push(
      `vor=${components.vor.toFixed(1)} weight=${strategy.vorWeight} contrib=${(strategy.vorWeight * components.vor).toFixed(2)} (CBS projections only)`
    );
  }
  if (components.penalties > 0) {
    notes.push(`penalties=${components.penalties.toFixed(1)} subtracted from weighted total`);
  }
  if (plan) {
    notes.push(`soft plan at pick ${state.currentOverallPick}: ${plan} (not a hard constraint)`);
  }
  return notes;
}

function contribLine(name: string, value: number, weight: number, extra?: string): string {
  const contrib = weight * value;
  const detail = extra ? `; ${extra}` : "";
  return `${name}=${value.toFixed(1)} weight=${weight} contrib=${contrib.toFixed(2)}${detail}`;
}
