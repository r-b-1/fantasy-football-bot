import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { CandidateScore, DraftDecision, DraftState, LeagueConfig } from "../domain/types.js";
import { deterministicDecision } from "../engine/decision.js";

const DraftDecisionSchema = z.object({
  selectedCandidateId: z.string(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(600),
  alternativeCandidateIds: z.array(z.string()).max(4),
  riskFlags: z.array(
    z.enum([
      "NONE",
      "POSITION_RUN",
      "TIER_CLIFF",
      "ROSTER_IMBALANCE",
      "BYE_OVERLAP",
      "LOW_CONFIDENCE",
      "STALE_DATA"
    ])
  )
});

export interface AIOptions {
  model: string;
  reasoningEffort: "none" | "minimal" | "low" | "medium" | "high";
  timeoutMs: number;
  confidenceThreshold: number;
}

export async function chooseWithAI(
  candidates: CandidateScore[],
  state: DraftState,
  league: LeagueConfig,
  options: AIOptions
): Promise<DraftDecision> {
  const fallback = deterministicDecision(candidates);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallback;

  const shortlist = candidates.map((c) => ({
    id: c.player.id,
    name: c.player.name,
    position: c.player.position,
    nflTeam: c.player.nflTeam ?? null,
    sportslineRating: c.player.sportslineRating,
    adp: c.player.adp,
    projectedPoints: c.player.projectedPoints ?? null,
    deterministicScore: c.score,
    componentScores: c.components
  }));
  const allowedIds = new Set(shortlist.map((c) => c.id));

  const systemPrompt = [
    "You are a fantasy-football draft decision layer for one 16-team CBS keeper league.",
    "You may ONLY select a candidate ID from the supplied shortlist.",
    "The league is full PPR and starts 3 WR, so RB/WR depth is valuable.",
    "Account for 16-team QB scarcity, but do not reach past materially better RB/WR value.",
    "Use TE tier cliffs when relevant. K and DST should generally be late.",
    "SportsLine rating is an important model input; ADP is market information, not a direct live-draft pick because keepers distort the pool.",
    "Prefer the best total roster/value outcome, not simply filling an empty position.",
    "Return a concise rationale."
  ].join(" ");

  const payload = {
    currentOverallPick: state.currentOverallPick,
    nextUserOverallPick: state.nextUserOverallPick,
    roster: state.roster.players,
    recentPositionCounts: state.recentPositionCounts,
    lineup: league.lineup,
    teamCount: league.teamCount,
    candidates: shortlist
  };

  try {
    const client = new OpenAI({ apiKey, timeout: options.timeoutMs });
    const response = await client.responses.parse({
      model: options.model,
      reasoning: { effort: options.reasoningEffort },
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(payload) }
      ],
      text: {
        format: zodTextFormat(DraftDecisionSchema, "draft_decision")
      }
    });

    const parsed = response.output_parsed;
    if (!parsed) return fallback;
    if (!allowedIds.has(parsed.selectedCandidateId)) return fallback;
    if (parsed.alternativeCandidateIds.some((id) => !allowedIds.has(id))) return fallback;
    if (parsed.confidence < options.confidenceThreshold) return fallback;

    return { ...parsed, source: "ai" };
  } catch {
    return fallback;
  }
}
