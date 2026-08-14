import { describe, expect, it } from "vitest";
import { chooseWithAI, type DecisionModel } from "../src/ai/openai.js";
import { buildDecisionPayload } from "../src/ai/prompt.js";
import { loadLeagueConfig, loadStrategyConfig } from "../src/config/load.js";
import type { CandidateScore, DraftState, LivePlayer } from "../src/domain/types.js";

const league = loadLeagueConfig("config/league.current.json");
const strategy = loadStrategyConfig("config/strategy.current.json");

function player(id: string, name: string, position: LivePlayer["position"]): LivePlayer {
  return {
    id,
    sourceName: name,
    name,
    position,
    sportslineRating: 80,
    adp: 30,
    listedRound: 3,
    byeWeek: 7,
    available: true
  };
}

function candidate(live: LivePlayer, score: number): CandidateScore {
  return {
    player: live,
    score,
    components: {
      sportslineRating: live.sportslineRating,
      adpValue: 50,
      rosterNeed: 80,
      scarcity: 70,
      nextPickRisk: 60,
      tierCliff: 55,
      penalties: 0
    },
    notes: [`total=${score}`]
  };
}

const candidates = [
  candidate(player("puka nacua::WR", "Puka Nacua", "WR"), 90),
  candidate(player("jonathan taylor::RB", "Jonathan Taylor", "RB"), 88),
  candidate(player("trey mcbride::TE", "Trey McBride", "TE"), 86)
];

const state: DraftState = {
  currentOverallPick: 3,
  nextUserOverallPick: 21,
  teamOnClock: league.userTeamName,
  isUserTurn: true,
  clockSecondsRemaining: 47,
  snapshotAt: "test",
  roster: {
    players: [
      { playerId: "ashton jeanty::RB", name: "Ashton Jeanty", position: "RB", byeWeek: 13, source: "keeper" },
      { playerId: "george pickens::WR", name: "George Pickens", position: "WR", byeWeek: 14, source: "keeper" }
    ]
  },
  draftEvents: [],
  availablePlayerIds: new Set(candidates.map((c) => c.player.id)),
  recentPositionCounts: { RB: 2 },
  warnings: []
};

const options = {
  model: "gpt-5.6",
  reasoningEffort: "low" as const,
  timeoutMs: 50,
  confidenceThreshold: 0.65
};

function modelReturning(parsed: unknown, delayMs = 0): DecisionModel {
  return {
    async parse() {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return parsed;
    }
  };
}

const validAiChoice = {
  selectedCandidateId: "jonathan taylor::RB",
  confidence: 0.88,
  rationale: "Balance the roster with a premium RB after keeping Jeanty/Pickens.",
  alternativeCandidateIds: ["puka nacua::WR"],
  riskFlags: ["NONE"]
};

describe("bounded AI decision layer", () => {
  it("can reorder a fixture shortlist to another in-list candidate", async () => {
    const decision = await chooseWithAI(candidates, state, league, strategy, {
      ...options,
      decisionModel: modelReturning(validAiChoice)
    });
    expect(decision.source).toBe("ai");
    expect(decision.selectedCandidateId).toBe("jonathan taylor::RB");
    expect(decision.selectedCandidateId).not.toBe(candidates[0]!.player.id);
  });

  it("rejects an injected out-of-set candidate and falls back to deterministic #1", async () => {
    const decision = await chooseWithAI(candidates, state, league, strategy, {
      ...options,
      decisionModel: modelReturning({
        ...validAiChoice,
        selectedCandidateId: "invented-star::QB"
      })
    });
    expect(decision.source).toBe("deterministic_fallback");
    expect(decision.selectedCandidateId).toBe("puka nacua::WR");
    expect(decision.fallbackReason).toMatch(/not in the shortlist/);
  });

  it("falls back on timeout", async () => {
    const decision = await chooseWithAI(candidates, state, league, strategy, {
      ...options,
      timeoutMs: 20,
      decisionModel: modelReturning(validAiChoice, 200)
    });
    expect(decision.source).toBe("deterministic_fallback");
    expect(decision.selectedCandidateId).toBe("puka nacua::WR");
    expect(decision.fallbackReason).toMatch(/timeout/i);
  });

  it("falls back on API error", async () => {
    const decision = await chooseWithAI(candidates, state, league, strategy, {
      ...options,
      decisionModel: {
        parse: async () => {
          throw new Error("network down");
        }
      }
    });
    expect(decision.source).toBe("deterministic_fallback");
    expect(decision.fallbackReason).toBe("network down");
  });

  it("falls back on malformed structured output", async () => {
    const decision = await chooseWithAI(candidates, state, league, strategy, {
      ...options,
      decisionModel: modelReturning({ nope: true })
    });
    expect(decision.source).toBe("deterministic_fallback");
    expect(decision.fallbackReason).toMatch(/invalid structured output/);
  });

  it("falls back below the confidence threshold", async () => {
    const decision = await chooseWithAI(candidates, state, league, strategy, {
      ...options,
      decisionModel: modelReturning({ ...validAiChoice, confidence: 0.2 })
    });
    expect(decision.source).toBe("deterministic_fallback");
    expect(decision.fallbackReason).toMatch(/confidence/);
  });

  it("sends compact structured state with no HTML or cookies", () => {
    const payload = buildDecisionPayload(candidates, state, league, strategy);
    const encoded = JSON.stringify(payload);
    expect(payload.candidateIds).toEqual(candidates.map((c) => c.player.id));
    expect(encoded).not.toMatch(/<html/i);
    expect(encoded).not.toMatch(/cookie/i);
    expect(encoded).not.toMatch(/apiKey/i);
    expect((payload.roster as Record<string, string[]>).RB).toContain("Ashton Jeanty");
  });

  it("falls back when no API key or model is configured", async () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const decision = await chooseWithAI(candidates, state, league, strategy, {
      ...options,
      apiKey: null
    });
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
    expect(decision.source).toBe("deterministic_fallback");
    expect(decision.fallbackReason).toMatch(/OPENAI_API_KEY/);
  });
});
