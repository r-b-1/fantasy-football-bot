import { describe, expect, it } from "vitest";
import { loadLeagueConfig, loadStrategyConfig } from "../src/config/load.js";
import { loadSportslineWorkbook } from "../src/data/sportsline.js";
import { recommendTurn, shouldRecommendForTurn } from "../src/engine/recommend.js";
import { shouldProjectForTurn } from "../src/engine/predict.js";
import { eligiblePlayers } from "../src/engine/shortlist.js";
import {
  applyLiveTurnIdentity,
  estimatedDraftRounds,
  snakeDraftSlot,
  snakeOverallPicks
} from "../src/engine/state.js";
import type { DraftState } from "../src/domain/types.js";

const sportslinePath = "data/reference/cheatsheet_cbsppr12.xlsx";

describe("snake pick inventory", () => {
  it("matches a vanilla 16-team slot-3 snake before trades", () => {
    expect(snakeDraftSlot(3, 16)).toBe(3);
    expect(snakeDraftSlot(30, 16)).toBe(3);
    expect(snakeDraftSlot(35, 16)).toBe(3);
    expect(snakeOverallPicks(3, 16, 4)).toEqual([3, 30, 35, 62]);
  });

  it("matches a 12-team slot-3 snake used by CBS public mocks", () => {
    expect(snakeDraftSlot(3, 12)).toBe(3);
    expect(snakeDraftSlot(22, 12)).toBe(3);
    expect(snakeOverallPicks(3, 12, 4)).toEqual([3, 22, 27, 46]);
  });
});

describe("live turn identity lock", () => {
  it("does not rewrite the real league config", () => {
    const league = loadLeagueConfig("config/league.current.json");
    expect(league.inferUserTeamFromYouAreUp).toBe(false);
    const next = applyLiveTurnIdentity(league, {
      youAreUp: true,
      teamOnClock: "Someone Else",
      currentOverallPick: 3
    });
    expect(next).toBe(league);
  });

  it("locks mock team name and snake picks from the first YOU ARE UP snapshot", () => {
    const league = loadLeagueConfig("config/league.mock.json");
    expect(league.cbsExecutionEnabled).toBe(false);
    expect(league.keepers).toEqual([]);
    const next = applyLiveTurnIdentity(league, {
      youAreUp: true,
      teamOnClock: "Jack Oien",
      currentOverallPick: 3
    });
    expect(next.userTeamName).toBe("Jack Oien");
    expect(next.draftSlot).toBe(3);
    expect(next.knownOverallPicks.slice(0, 4)).toEqual([3, 22, 27, 46]);
    expect(next.knownOverallPicks).toHaveLength(estimatedDraftRounds(next));
  });

  it("locks 12-team slot 2 from overall pick 2, not from the round number", () => {
    const league = loadLeagueConfig("config/league.mock.confirm.json");
    const next = applyLiveTurnIdentity(league, {
      youAreUp: true,
      teamOnClock: "pickens fan",
      currentOverallPick: 2
    });
    expect(next.userTeamName).toBe("pickens fan");
    expect(next.draftSlot).toBe(2);
    expect(next.knownOverallPicks.slice(0, 4)).toEqual([2, 23, 26, 47]);
  });
});

describe("recommend turn", () => {
  it("recommends once per overall pick", () => {
    const seen = new Set<number>([3]);
    expect(shouldRecommendForTurn(true, 3, seen)).toBeNull();
    expect(shouldRecommendForTurn(true, 21, seen)).toBe(21);
    expect(shouldRecommendForTurn(false, 21, seen)).toBeNull();
    expect(shouldRecommendForTurn(true, null, seen)).toBeNull();
  });

  it("projects once per non-user overall pick and skips the user turn", () => {
    const seen = new Set<number>([2]);
    expect(shouldProjectForTurn(true, false, 2, seen)).toBeNull();
    expect(shouldProjectForTurn(true, false, 4, seen)).toBe(4);
    expect(shouldProjectForTurn(true, true, 3, seen)).toBeNull();
    expect(shouldProjectForTurn(false, false, 4, seen)).toBeNull();
    expect(shouldProjectForTurn(true, false, null, seen)).toBeNull();
  });

  it("keeps Jeanty available in a public mock and returns a deterministic shortlist", async () => {
    const league = loadLeagueConfig("config/league.mock.json");
    const strategy = loadStrategyConfig("config/strategy.current.json");
    const players = loadSportslineWorkbook(sportslinePath);
    const availablePlayerIds = new Set(players.map((player) => player.id));
    const state: DraftState = {
      currentOverallPick: 1,
      nextUserOverallPick: 24,
      teamOnClock: "Jack Oien",
      isUserTurn: true,
      clockSecondsRemaining: 45,
      snapshotAt: "test",
      roster: { players: [] },
      draftEvents: [],
      availablePlayerIds,
      recentPositionCounts: {},
      warnings: []
    };

    expect(availablePlayerIds.has("ashton jeanty::RB")).toBe(true);
    expect(availablePlayerIds.has("george pickens::WR")).toBe(true);

    const result = await recommendTurn({
      players,
      state,
      league,
      strategy,
      useAI: false,
      explain: "top"
    });
    expect(result.ranked.length).toBeGreaterThan(0);
    expect(result.decision.source).toBe("deterministic_fallback");
    expect(result.output).toMatch(/PICK 1/);
    expect(result.output).toMatch(/Mode: RECOMMEND/);
    const eligible = eligiblePlayers(
      players.map((player) => ({ ...player, available: true })),
      state,
      league,
      strategy
    );
    expect(eligible.some((player) => player.id === "ashton jeanty::RB")).toBe(true);
    expect(eligible.some((player) => player.id === "george pickens::WR")).toBe(true);
  });
});
