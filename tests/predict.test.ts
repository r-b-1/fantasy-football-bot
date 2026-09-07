import { describe, expect, it } from "vitest";
import { deterministicProjection, projectionHorizonFromStrategy } from "../src/engine/predict.js";
import { predictNextPicks, type ProjectionModel } from "../src/ai/predict.js";
import { loadLeagueConfig, loadStrategyConfig } from "../src/config/load.js";
import type { DraftState, LivePlayer } from "../src/domain/types.js";

const league = loadLeagueConfig("config/league.current.json");
const strategy = loadStrategyConfig("config/strategy.current.json");

function player(overrides: Partial<LivePlayer> & Pick<LivePlayer, "id" | "name" | "position">): LivePlayer {
  return {
    sourceName: overrides.name,
    sportslineRating: 80,
    adp: 30,
    listedRound: 3,
    byeWeek: 7,
    available: true,
    ...overrides
  };
}

function state(overrides: Partial<DraftState> = {}): DraftState {
  return {
    currentOverallPick: 21,
    nextUserOverallPick: 30,
    teamOnClock: league.userTeamName,
    isUserTurn: true,
    clockSecondsRemaining: null,
    snapshotAt: "test",
    roster: { players: [] },
    draftEvents: [],
    availablePlayerIds: new Set(),
    recentPositionCounts: {},
    warnings: [],
    ...overrides
  };
}

describe("deterministic projection", () => {
  it("projects remaining players in ADP order up to the horizon", () => {
    const pool = [
      player({ id: "wr1::WR", name: "WR One", position: "WR", adp: 22 }),
      player({ id: "rb1::RB", name: "RB One", position: "RB", adp: 24 }),
      player({ id: "wr2::WR", name: "WR Two", position: "WR", adp: 26 }),
      player({ id: "qb1::QB", name: "QB One", position: "QB", adp: 28 })
    ];
    const current = state({
      availablePlayerIds: new Set(pool.map((p) => p.id))
    });
    const projection = deterministicProjection(pool, current, league, strategy, { horizon: 3 });
    expect(projection.projectedPicks.map((p) => p.playerId)).toEqual(["wr1::WR", "rb1::RB", "wr2::WR"]);
    expect(projection.horizon).toBe(3);
  });

  it("ignores already-taken players", () => {
    const pool = [
      player({ id: "wr1::WR", name: "WR One", position: "WR", adp: 22 }),
      player({ id: "rb1::RB", name: "RB One", position: "RB", adp: 24 })
    ];
    const current = state({
      availablePlayerIds: new Set(["rb1::RB"])
    });
    const projection = deterministicProjection(pool, current, league, strategy, { horizon: 3 });
    expect(projection.projectedPicks.map((p) => p.playerId)).toEqual(["rb1::RB"]);
  });

  it("returns an empty projection with a note when no ADP is available", () => {
    const pool = [
      player({ id: "wr1::WR", name: "WR One", position: "WR", adp: null })
    ];
    const current = state({
      availablePlayerIds: new Set(pool.map((p) => p.id))
    });
    const projection = deterministicProjection(pool, current, league, strategy, { horizon: 3 });
    expect(projection.projectedPicks).toEqual([]);
    expect(projection.notes.length).toBeGreaterThan(0);
  });

  it("derives horizon from strategy shortlist size", () => {
    expect(projectionHorizonFromStrategy({ ...strategy, candidateShortlistSize: 4 })).toBe(6);
    expect(projectionHorizonFromStrategy({ ...strategy, candidateShortlistSize: 8 })).toBe(8);
    expect(projectionHorizonFromStrategy({ ...strategy, candidateShortlistSize: 15 })).toBe(10);
  });
});

describe("AI projection layer", () => {
  function modelReturning(parsed: unknown, delayMs = 0): ProjectionModel {
    return {
      async parse() {
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        return parsed;
      }
    };
  }

  const pool = [
    player({ id: "wr1::WR", name: "WR One", position: "WR", adp: 22 }),
    player({ id: "rb1::RB", name: "RB One", position: "RB", adp: 24 }),
    player({ id: "wr2::WR", name: "WR Two", position: "WR", adp: 26 })
  ];
  const current = state({
    currentOverallPick: 21,
    availablePlayerIds: new Set(pool.map((p) => p.id))
  });

  it("returns AI-sourced projection when output is valid and bounded", async () => {
    const result = await predictNextPicks({
      players: pool,
      state: current,
      league,
      strategy,
      useAI: true,
      model: modelReturning({
        picks: [
          { playerId: "wr1::WR", playerName: "WR One", expectedOverallPick: 22, confidence: 0.81 },
          { playerId: "rb1::RB", playerName: "RB One", expectedOverallPick: 24, confidence: 0.74 }
        ],
        rationale: "Top two by ADP."
      })
    });
    expect(result.source).toBe("ai");
    expect(result.projectedPicks.map((p) => p.playerId)).toEqual(["wr1::WR", "rb1::RB"]);
  });

  it("falls back to deterministic when an AI pick is not in the available pool", async () => {
    const result = await predictNextPicks({
      players: pool,
      state: current,
      league,
      strategy,
      useAI: true,
      model: modelReturning({
        picks: [
          { playerId: "ghost::WR", playerName: "Ghost", expectedOverallPick: 22, confidence: 0.9 }
        ],
        rationale: "wrong"
      })
    });
    expect(result.source).toBe("deterministic");
    expect(result.fallbackReason).toMatch(/not in the available pool/);
    expect(result.projectedPicks[0]!.playerId).toBe("wr1::WR");
  });

  it("falls back on AI timeout", async () => {
    const result = await predictNextPicks({
      players: pool,
      state: current,
      league,
      strategy,
      useAI: true,
      timeoutMs: 20,
      model: modelReturning(
        {
          picks: [{ playerId: "wr1::WR", playerName: "WR One", expectedOverallPick: 22, confidence: 0.9 }],
          rationale: "ok"
        },
        200
      )
    });
    expect(result.source).toBe("deterministic");
    expect(result.fallbackReason).toMatch(/timeout/i);
  });

  it("falls back when AI is disabled", async () => {
    const result = await predictNextPicks({
      players: pool,
      state: current,
      league,
      strategy,
      useAI: false
    });
    expect(result.source).toBe("deterministic");
    expect(result.fallbackReason).toMatch(/AI disabled/);
  });

  it("falls back on malformed structured output", async () => {
    const result = await predictNextPicks({
      players: pool,
      state: current,
      league,
      strategy,
      useAI: true,
      model: modelReturning({ nope: true })
    });
    expect(result.source).toBe("deterministic");
    expect(result.fallbackReason).toMatch(/invalid structured output/);
  });

  it("rejects duplicate projected players", async () => {
    const result = await predictNextPicks({
      players: pool,
      state: current,
      league,
      strategy,
      useAI: true,
      model: modelReturning({
        picks: [
          { playerId: "wr1::WR", playerName: "WR One", expectedOverallPick: 22, confidence: 0.8 },
          { playerId: "wr1::WR", playerName: "WR One", expectedOverallPick: 23, confidence: 0.7 }
        ],
        rationale: "dupe"
      })
    });
    expect(result.source).toBe("deterministic");
    expect(result.fallbackReason).toMatch(/duplicate/);
  });
});