import { chooseWithAI, defaultAIOptions } from "../ai/openrouter.js";
import { formatRecommendation } from "../cli/format.js";
import type { CandidateScore, DraftDecision, DraftState, LeagueConfig, SportslinePlayer, StrategyConfig } from "../domain/types.js";
import { appendEvent } from "../state/eventLog.js";
import { deterministicDecision } from "./decision.js";
import { generateShortlist } from "./shortlist.js";

export interface RecommendTurnInput {
  players: SportslinePlayer[];
  state: DraftState;
  league: LeagueConfig;
  strategy: StrategyConfig;
  useAI?: boolean;
  eventLogPath?: string;
  explain?: "all" | "top" | "none";
  /** When set, this is a banner preview for another team — do not log as our pick. */
  previewForTeam?: string;
}

export interface RecommendTurnResult {
  ranked: CandidateScore[];
  decision: DraftDecision;
  output: string;
}

export function shouldRecommendForTurn(
  isUserTurn: boolean,
  currentOverallPick: number | null,
  alreadyRecommended: ReadonlySet<number>
): number | null {
  if (!isUserTurn || currentOverallPick == null || currentOverallPick <= 0) return null;
  if (alreadyRecommended.has(currentOverallPick)) return null;
  return currentOverallPick;
}

export async function recommendTurn(input: RecommendTurnInput): Promise<RecommendTurnResult> {
  const ranked = generateShortlist(
    input.players.map((player) => ({
      ...player,
      available: input.state.availablePlayerIds.has(player.id)
    })),
    input.state,
    input.league,
    input.strategy
  );
  const decision = input.useAI
    ? await chooseWithAI(ranked, input.state, input.league, input.strategy, defaultAIOptions(input.strategy))
    : deterministicDecision(ranked);
  const selected =
    ranked.find((candidate) => candidate.player.id === decision.selectedCandidateId) ?? ranked[0]!;

  if (input.eventLogPath && !input.previewForTeam) {
    appendEvent(input.eventLogPath, {
      type: "shortlist",
      overallPick: input.state.currentOverallPick,
      candidateIds: ranked.map((candidate) => candidate.player.id)
    });
    appendEvent(input.eventLogPath, {
      type: "recommendation",
      overallPick: input.state.currentOverallPick,
      candidateId: selected.player.id,
      playerName: selected.player.name,
      score: selected.score,
      notes: selected.notes
    });
    if (input.useAI) {
      appendEvent(input.eventLogPath, {
        type: "ai_decision",
        overallPick: input.state.currentOverallPick,
        candidateId: decision.selectedCandidateId,
        confidence: decision.confidence,
        source: decision.source,
        latencyMs: decision.latencyMs,
        fallbackReason: decision.fallbackReason
      });
    }
  }

  return {
    ranked,
    decision,
    output: formatRecommendation(ranked, input.state, input.league, decision, {
      explain: input.explain ?? "top",
      previewForTeam: input.previewForTeam
    })
  };
}
