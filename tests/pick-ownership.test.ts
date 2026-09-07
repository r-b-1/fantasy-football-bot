import { describe, expect, it } from "vitest";
import { loadLeagueConfig, loadStrategyConfig } from "../src/config/load.js";
import { parseRosterGrid } from "../src/data/rosterGrid.js";
import { deterministicProjection } from "../src/engine/predict.js";
import { ownerOfPick, weightedNextPickByTeam } from "../src/engine/teamNeed.js";
import type { DraftState, LeagueConfig, LivePlayer } from "../src/domain/types.js";

const league = loadLeagueConfig("config/league.current.json");
const strategy = loadStrategyConfig("config/strategy.current.json");

function player(overrides: Partial<LivePlayer> & Pick<LivePlayer, "id" | "name" | "position">): LivePlayer {
  return {
    sourceName: overrides.name,
    sportslineRating: 90,
    adp: 10,
    listedRound: 1,
    byeWeek: 7,
    available: true,
    ...overrides
  };
}

function state(overrides: Partial<DraftState> = {}): DraftState {
  return {
    currentOverallPick: 20,
    nextUserOverallPick: 21,
    teamOnClock: "Phil Belichick",
    isUserTurn: false,
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

describe("pick ownership after trades", () => {
  it("gives the user overall pick 21 (traded) instead of snake slot 3's next pick 30", () => {
    const next = weightedNextPickByTeam({
      league,
      currentOverallPick: 20,
      userTeamName: league.userTeamName,
      knownUserOverallPicks: league.knownOverallPicks
    });
    expect(next.get(league.userTeamName.toLowerCase())).toBe(21);
  });

  it("does not leave pick 21 with the original snake slot-12 team", () => {
    expect(ownerOfPick(league, 21)).toBe(league.userTeamName);
    expect(ownerOfPick(league, 3)).toBe(league.userTeamName);
    expect(ownerOfPick(league, 30)).toBe(league.userTeamName);
  });

  it("assigns the sent pick 62 to the trade partner, not the user", () => {
    expect(ownerOfPick(league, 62)).not.toBe(league.userTeamName);
    expect(ownerOfPick(league, 62)).toBe("Now we're Cookin'");
    const nextAt61 = weightedNextPickByTeam({
      league,
      currentOverallPick: 61,
      userTeamName: league.userTeamName,
      knownUserOverallPicks: league.knownOverallPicks
    });
    expect(nextAt61.get("now we're cookin'")).toBe(62);
    expect(nextAt61.get(league.userTeamName.toLowerCase())).toBe(67);
  });
});

describe("need-aware projection uses draft order, not roster-grid row order", () => {
  it("projects pick 1 for the slot-1 team even when that team is listed last in the grid", () => {
    const miniLeague: LeagueConfig = {
      ...league,
      teamCount: 2,
      draftSlot: 2,
      userTeamName: "Slot Two",
      knownOverallPicks: [2, 3],
      knownPicksArePartial: false,
      draftOrder: ["Slot One", "Slot Two"],
      leaguePicks: [],
      leaguePicksArePartial: true
    };
    const grid = parseRosterGrid(
      [
        "Team,QB,RB,WR,TE,K,DST",
        "Slot Two,,B Hall;B Robinson,,,,",
        "Slot One,,,A One;B Two;C Three,,,"
      ].join("\n"),
      "test"
    );
    const pool = [
      player({ id: "wr1::WR", name: "Alpha WR", position: "WR", adp: 1, sportslineRating: 99 }),
      player({ id: "rb1::RB", name: "Beta RB", position: "RB", adp: 1.1, sportslineRating: 99 })
    ];
    const current = state({
      currentOverallPick: 0,
      availablePlayerIds: new Set(pool.map((p) => p.id))
    });
    const projection = deterministicProjection(pool, current, miniLeague, strategy, {
      horizon: 1,
      rosterGrid: grid
    });
    expect(ownerOfPick(miniLeague, 1)).toBe("Slot One");
    expect(projection.projectedPicks[0]?.playerId).toBe("rb1::RB");
    expect(projection.projectedPicks[0]?.expectedOverallPick).toBe(1);
  });
});
