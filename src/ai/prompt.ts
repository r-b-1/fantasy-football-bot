import { POSITIONS, type CandidateScore, type DraftState, type LeagueConfig, type StrategyConfig } from "../domain/types.js";

export function buildSystemPrompt(league: LeagueConfig, strategy: StrategyConfig): string {
  return [
    "You are a bounded fantasy-football draft decision layer.",
    "You may ONLY select selectedCandidateId and alternativeCandidateIds from the supplied candidateIds.",
    "Do not invent players, IDs, or facts that are not in the JSON.",
    `${league.scoringFormat} scoring, ${league.teamCount} teams, starters ${JSON.stringify(league.lineup)}.`,
    "Keepers are already on the roster and are not available.",
    "Prefer meaningful RB/WR value early in a 3-WR league.",
    "Account for 16-team QB scarcity without reaching past materially better RB/WR value.",
    "Use TE tier cliffs when they are large. K and DST should be late.",
    "SportsLine rating is a trusted model input, not an absolute command.",
    "ADP is market information; keepers distort live-draft pick equivalence.",
    "Prefer the best remaining roster/value outcome, not simply filling an empty slot.",
    `Soft plan if present is a hint, not a hard constraint. Shortlist size ${strategy.candidateShortlistSize}.`,
    "Return a concise rationale.",
    "",
    "OUTPUT FORMAT — STRICT:",
    "Reply with a single JSON object and nothing else. No markdown. No code fences. No prose.",
    "The first character of your reply must be '{' and the last character must be '}'.",
    "Do not wrap the JSON in any commentary before or after it.",
    "Required fields in the JSON:",
    "  selectedCandidateId (string from candidateIds)",
    "  confidence (number 0-1; how confident you are in the pick)",
    "  rationale (string; 1-3 sentences explaining the choice)",
    "  alternativeCandidateIds (array of up to 4 strings from candidateIds, excluding the selected one)",
    "  riskFlags (array; e.g. [\"NONE\"] or [\"POSITION_RUN\",\"TIER_CLIFF\"])"
  ].join("\n");
}

export function buildDecisionPayload(
  candidates: CandidateScore[],
  state: DraftState,
  league: LeagueConfig,
  strategy: StrategyConfig
): Record<string, unknown> {
  const roster: Record<string, string[]> = {};
  for (const position of POSITIONS) {
    roster[position] = state.roster.players
      .filter((player) => player.position === position)
      .map((player) => player.name);
  }

  return {
    currentOverallPick: state.currentOverallPick,
    nextUserPick: state.nextUserOverallPick,
    teamOnClock: state.teamOnClock,
    isUserTurn: state.isUserTurn,
    roster,
    recentPositionCounts: state.recentPositionCounts,
    lineup: league.lineup,
    teamCount: league.teamCount,
    scoringFormat: league.scoringFormat,
    softPlan: strategy.softDraftPlan[String(state.currentOverallPick)] ?? null,
    candidateIds: candidates.map((candidate) => candidate.player.id),
    candidates: candidates.map((candidate) => ({
      id: candidate.player.id,
      name: candidate.player.name,
      position: candidate.player.position,
      nflTeam: candidate.player.nflTeam ?? null,
      sportslineRating: candidate.player.sportslineRating,
      adp: candidate.player.adp,
      byeWeek: candidate.player.byeWeek,
      projectedPoints: candidate.player.projectedPoints ?? null,
      deterministicScore: candidate.score,
      componentScores: candidate.components
    }))
  };
}
