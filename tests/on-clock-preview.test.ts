import { describe, expect, it } from "vitest";
import { loadLeagueConfig, loadStrategyConfig } from "../src/config/load.js";
import { loadRosterGrid } from "../src/data/rosterGrid.js";
import { resolveProjectionKeepers } from "../src/data/leagueKeepers.js";
import { loadSportslineWorkbook } from "../src/data/sportsline.js";
import { recommendTurn } from "../src/engine/recommend.js";
import { draftStateForOnClockTeam, rosterPlayersForTeam } from "../src/engine/onClockPreview.js";
import type { DraftState } from "../src/domain/types.js";

const league = loadLeagueConfig("config/league.current.json");
const strategy = loadStrategyConfig("config/strategy.current.json");
const grid = loadRosterGrid("docs/roster-grid (1).csv");
const keepers = resolveProjectionKeepers(league);

function baseState(overrides: Partial<DraftState> = {}): DraftState {
  return {
    currentOverallPick: 2,
    nextUserOverallPick: 3,
    teamOnClock: "Gibbs me a win",
    isUserTurn: false,
    clockSecondsRemaining: 8,
    snapshotAt: "test",
    roster: { players: [] },
    draftEvents: [
      {
        overallPick: 1,
        fantasyTeam: "Hairy Butterscotch",
        playerId: "jahmyr gibbs::RB",
        playerName: "Jahmyr Gibbs",
        position: "RB",
        observedAt: "test"
      }
    ],
    availablePlayerIds: new Set(),
    recentPositionCounts: {},
    warnings: [],
    ...overrides
  };
}

describe("on-clock team roster", () => {
  it("loads keepers and grid starters for the team on the clock, not the user", () => {
    const roster = rosterPlayersForTeam({
      teamName: "Now we're Cookin'",
      players: loadSportslineWorkbook("data/reference/cheatsheet_cbsppr12.xlsx"),
      draftEvents: [],
      keepers,
      rosterGrid: grid
    });
    expect(roster.some((p) => /walker/i.test(p.name) && p.source === "keeper")).toBe(true);
    expect(roster.some((p) => /jeanty/i.test(p.name))).toBe(false);
    expect(roster.some((p) => /pickens/i.test(p.name))).toBe(false);
  });

  it("counts Gibbs me a win's preseason RB so their recommend banner is not an empty roster", () => {
    const roster = rosterPlayersForTeam({
      teamName: "Gibbs me a win",
      players: loadSportslineWorkbook("data/reference/cheatsheet_cbsppr12.xlsx"),
      draftEvents: [],
      keepers,
      rosterGrid: grid
    });
    expect(roster.some((p) => p.position === "RB")).toBe(true);
    expect(roster.some((p) => p.position === "WR")).toBe(true);
  });
});

describe("on-clock recommend banner preview", () => {
  it("prints the same recommend banner for the team on the clock", async () => {
    const players = loadSportslineWorkbook("data/reference/cheatsheet_cbsppr12.xlsx");
    const liveState = baseState({
      availablePlayerIds: new Set(players.map((p) => p.id).filter((id) => id !== "jahmyr gibbs::RB"))
    });
    const previewState = draftStateForOnClockTeam({
      state: liveState,
      teamName: "Gibbs me a win",
      league,
      players,
      keepers,
      rosterGrid: grid
    });
    const result = await recommendTurn({
      players,
      state: previewState,
      league,
      strategy,
      useAI: false,
      previewForTeam: "Gibbs me a win",
      explain: "top"
    });
    expect(result.output).toMatch(/LIKELY PICK FOR Gibbs me a win/i);
    expect(result.output).toMatch(/PICK 2/);
    expect(result.output).toMatch(/Mode: RECOMMEND/);
    expect(result.output).toMatch(/Fallback:/);
    expect(result.output).toMatch(/is on the clock/);
    expect(previewState.roster.players.length).toBeGreaterThan(0);
    expect(previewState.isUserTurn).toBe(true);
  });
});
