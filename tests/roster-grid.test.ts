import { describe, expect, it } from "vitest";
import {
  allTeamNames,
  loadRosterGrid,
  parseRosterGrid,
  teamStarterCount
} from "../src/data/rosterGrid.js";
import {
  computeTeamNeeds,
  scoreProjectedPickForTeam,
  weightedNextPickByTeam
} from "../src/engine/teamNeed.js";
import { deterministicProjection } from "../src/engine/predict.js";
import { loadLeagueConfig, loadStrategyConfig } from "../src/config/load.js";
import type { DraftState, LivePlayer } from "../src/domain/types.js";
import { toLivePlayers } from "../src/engine/state.js";

const league = loadLeagueConfig("config/league.current.json");
const strategy = loadStrategyConfig("config/strategy.current.json");

function makePlayer(overrides: Partial<LivePlayer> & Pick<LivePlayer, "id" | "name" | "position">): LivePlayer {
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

function makeState(overrides: Partial<DraftState> = {}): DraftState {
  return {
    currentOverallPick: 2,
    nextUserOverallPick: 3,
    teamOnClock: "Hairy Butterscotch",
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

describe("roster grid CSV parser", () => {
  it("parses the provided CSV into 16 team rosters with correct positions", () => {
    const grid = loadRosterGrid("docs/roster-grid (1).csv");
    expect(grid.teams.length).toBe(16);

    const chase = grid.teams.find((team) => team.teamName === "Chase'n my Puka");
    expect(chase).toBeDefined();
    expect(teamStarterCount(chase!, "WR")).toBe(2);
    const wrNames = chase!.starters.WR?.map((entry) => entry.name);
    expect(wrNames).toContain("P Nacua");
    expect(wrNames).toContain("J'Marr Chase");

    const clyde = grid.teams.find((team) => team.teamName === "Clyde");
    expect(clyde).toBeDefined();
    expect(clyde!.starters.QB?.map((entry) => entry.name)).toContain("J Allen");
    expect(clyde!.starters.WR?.map((entry) => entry.name + (entry.isRookie ? "(R)" : ""))).toContain(
      "D London(R)"
    );

    const dezzie = grid.teams.find((team) => team.teamName === "Dezzie Does Dallas");
    expect(dezzie).toBeDefined();
    expect(dezzie!.starters.RB?.map((entry) => entry.name)).toContain("C McCaffrey");

    const phil = grid.teams.find((team) => team.teamName === "Phil Belichick");
    expect(phil).toBeDefined();
    expect(phil!.starters.RB?.map((entry) => entry.name + (entry.isRookie ? "(R)" : ""))).toEqual([
      "J Taylor(R)",
      "D Henry(R)"
    ]);
  });

  it("handles a roster CSV with glued names and Mc-prefix correctly", () => {
    const csv = [
      "Team,QB,RB,WR,TE,K,DST,",
      "Test Team,,,P NacuaC McCaffrey,,,"
    ].join("\n");
    const grid = parseRosterGrid(csv, "test");
    const team = grid.teams[0]!;
    const wr = team.starters.WR ?? [];
    expect(wr.map((e) => e.name)).toEqual(["P Nacua", "C McCaffrey"]);
  });
});

describe("team need computation", () => {
  it("computes per-team starter gaps and assigns next picks via snake math", () => {
    const grid = loadRosterGrid("docs/roster-grid (1).csv");
    const nextPicksByTeam = weightedNextPickByTeam({
      league,
      currentOverallPick: 2,
      userTeamName: league.userTeamName,
      knownUserOverallPicks: league.knownOverallPicks
    });
    const needs = computeTeamNeeds({
      rosterGrid: grid,
      drafted: [],
      nextPicksByTeam,
      league
    });
    expect(needs.length).toBe(16);
    const clyde = needs.find((n) => n.teamName === "Clyde");
    expect(clyde).toBeDefined();
    expect(clyde!.startingNeed.RB ?? 0).toBeGreaterThanOrEqual(2);
    expect(clyde!.startingNeed.WR).toBeGreaterThanOrEqual(2);
  });
});

describe("need-aware deterministic projection", () => {
  it("projects players into team-specific starter gaps when roster grid is provided", () => {
    const grid = loadRosterGrid("docs/roster-grid (1).csv");
    const players: LivePlayer[] = [
      makePlayer({ id: "j gibbs::RB", name: "J Gibbs", position: "RB", adp: 2 }),
      makePlayer({ id: "b hall::RB", name: "B Hall", position: "RB", adp: 5 }),
      makePlayer({ id: "a st. brown::WR", name: "A-Ra St. Brown", position: "WR", adp: 11 }),
      makePlayer({ id: "d london::WR", name: "D London", position: "WR", adp: 13, sportslineRating: 75 }),
      makePlayer({ id: "j allen::QB", name: "J Allen", position: "QB", adp: 25, sportslineRating: 99 }),
      makePlayer({ id: "j taylor::RB", name: "J Taylor", position: "RB", adp: 7, sportslineRating: 90 })
    ];
    const ids = new Set(players.map((p) => p.id));
    const livePlayers = toLivePlayers(players, new Set());
    const state = makeState({ availablePlayerIds: ids });

    const withoutGrid = deterministicProjection(livePlayers, state, league, strategy, { horizon: 4 });
    const withGrid = deterministicProjection(livePlayers, state, league, strategy, {
      horizon: 4,
      rosterGrid: grid
    });

    expect(withoutGrid.projectedPicks.length).toBeGreaterThan(0);
    expect(withGrid.projectedPicks.length).toBeGreaterThan(0);
    expect(withGrid.notes.join(" ")).toMatch(/Need-aware/);
  });

  it("scores a player higher when a team's starter gap matches the player's position", () => {
    const grid = loadRosterGrid("docs/roster-grid (1).csv");
    const nextPicksByTeam = weightedNextPickByTeam({
      league,
      currentOverallPick: 2,
      userTeamName: league.userTeamName,
      knownUserOverallPicks: league.knownOverallPicks
    });
    const needs = computeTeamNeeds({ rosterGrid: grid, drafted: [], nextPicksByTeam, league });
    const clyde = needs.find((n) => n.teamName === "Clyde")!;

    const rbScore = scoreProjectedPickForTeam({
      teamName: clyde.teamName,
      position: "RB",
      teamNeeds: needs
    });
    const kScore = scoreProjectedPickForTeam({
      teamName: clyde.teamName,
      position: "K",
      teamNeeds: needs
    });
    expect(rbScore).toBeGreaterThan(kScore);
  });
});