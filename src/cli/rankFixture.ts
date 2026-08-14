import { chooseWithAI, defaultAIOptions } from "../ai/openai.js";
import { loadLeagueConfig, loadStrategyConfig } from "../config/load.js";
import { loadDraftFixture } from "../data/fixture.js";
import { loadSportslineWorkbook } from "../data/sportsline.js";
import { deterministicDecision } from "../engine/decision.js";
import { generateShortlist } from "../engine/shortlist.js";
import { buildDraftStateFromFixture } from "../engine/state.js";
import { appendEvent } from "../state/eventLog.js";
import { formatRecommendation } from "./format.js";

export interface RankFixtureOptions {
  fixturePath: string;
  leaguePath: string;
  strategyPath: string;
  sportslinePath: string;
  eventLogPath?: string;
  useAI?: boolean;
}

export async function rankFixture(options: RankFixtureOptions): Promise<string> {
  const league = loadLeagueConfig(options.leaguePath);
  const strategy = loadStrategyConfig(options.strategyPath);
  const players = loadSportslineWorkbook(options.sportslinePath);
  const fixture = loadDraftFixture(options.fixturePath);
  const { state, livePlayers } = buildDraftStateFromFixture(players, fixture, league, strategy);
  const ranked = generateShortlist(livePlayers, state, league, strategy);
  const decision = options.useAI
    ? await chooseWithAI(ranked, state, league, strategy, defaultAIOptions(strategy))
    : deterministicDecision(ranked);

  if (options.eventLogPath) {
    appendEvent(options.eventLogPath, {
      type: "shortlist",
      overallPick: state.currentOverallPick,
      candidateIds: ranked.map((candidate) => candidate.player.id)
    });
    const selected =
      ranked.find((candidate) => candidate.player.id === decision.selectedCandidateId) ?? ranked[0]!;
    appendEvent(options.eventLogPath, {
      type: "recommendation",
      overallPick: state.currentOverallPick,
      candidateId: decision.selectedCandidateId,
      playerName: selected.player.name,
      score: selected.score,
      notes: selected.notes
    });
    if (options.useAI) {
      appendEvent(options.eventLogPath, {
        type: "ai_decision",
        overallPick: state.currentOverallPick,
        candidateId: decision.selectedCandidateId,
        confidence: decision.confidence,
        source: decision.source,
        latencyMs: decision.latencyMs,
        fallbackReason: decision.fallbackReason
      });
    }
  }

  return formatRecommendation(ranked, state, league, decision);
}
