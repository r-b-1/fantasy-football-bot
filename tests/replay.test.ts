import { describe, expect, it } from "vitest";
import { rankFixture } from "../src/cli/rankFixture.js";
import { renderReplayDemo } from "../src/cli/replayDemo.js";
import { loadLeagueConfig, loadStrategyConfig } from "../src/config/load.js";
import { loadDraftFixture } from "../src/data/fixture.js";
import { loadSportslineWorkbook } from "../src/data/sportsline.js";
import { EngineError } from "../src/domain/errors.js";
import { computeNextPickRisk } from "../src/engine/scoring.js";
import { generateShortlist } from "../src/engine/shortlist.js";
import { buildDraftStateFromFixture } from "../src/engine/state.js";

const leaguePath = "config/league.current.json";
const strategyPath = "config/strategy.current.json";
const sportslinePath = "data/reference/cheatsheet_cbsppr12.xlsx";

function rankAt(fixturePath: string) {
  const league = loadLeagueConfig(leaguePath);
  const strategy = loadStrategyConfig(strategyPath);
  const players = loadSportslineWorkbook(sportslinePath);
  const fixture = loadDraftFixture(fixturePath);
  const { state, livePlayers } = buildDraftStateFromFixture(players, fixture, league, strategy);
  return {
    league,
    strategy,
    state,
    livePlayers,
    shortlist: generateShortlist(livePlayers, state, league, strategy)
  };
}

describe("16-team fixture replay", () => {
  it("removes keepers and drafted players before ranking pick 3", () => {
    const { shortlist, livePlayers, state } = rankAt("fixtures/pick-3.json");
    const ids = new Set(shortlist.map((c) => c.player.id));
    expect(ids.has("ashton jeanty::RB")).toBe(false);
    expect(ids.has("george pickens::WR")).toBe(false);
    expect(ids.has("jahmyr gibbs::RB")).toBe(false);
    expect(ids.has("bijan robinson::RB")).toBe(false);
    expect(livePlayers.find((p) => p.id === "ashton jeanty::RB")?.available).toBe(false);
    expect(state.roster.players.map((p) => p.name)).toEqual(["Ashton Jeanty", "George Pickens"]);
    expect(shortlist.every((c) => c.player.position === "RB" || c.player.position === "WR" || c.player.position === "TE" || c.player.position === "QB")).toBe(true);
    expect(shortlist.every((c) => c.player.position !== "K" && c.player.position !== "DST")).toBe(true);
  });

  it("produces a repeatable shortlist at pick 21", () => {
    const first = rankAt("fixtures/pick-21.json");
    const second = rankAt("fixtures/pick-21.json");
    expect(first.shortlist.map((c) => [c.player.id, c.score])).toEqual(
      second.shortlist.map((c) => [c.player.id, c.score])
    );
    expect(first.state.currentOverallPick).toBe(21);
    expect(first.state.nextUserOverallPick).toBe(30);
    expect(first.state.isUserTurn).toBe(true);
    expect(first.shortlist).toHaveLength(7);
    expect(first.shortlist.every((c) => c.notes.length > 0)).toBe(true);
    expect(first.state.roster.players.some((p) => p.name === "Puka Nacua")).toBe(true);
    expect(first.shortlist.some((c) => c.player.name === "Puka Nacua")).toBe(false);
    expect(first.shortlist.every((c) => c.player.position !== "K")).toBe(true);
  });

  it("keeps next-pick risk higher at 35->67 than at 30->35 for the same ADP", () => {
    const at30Base = loadDraftFixture("fixtures/pick-35.json");
    const league = loadLeagueConfig(leaguePath);
    const strategy = loadStrategyConfig(strategyPath);
    const players = loadSportslineWorkbook(sportslinePath);
    const at30 = {
      ...at30Base,
      name: "pick-30",
      currentOverallPick: 30,
      drafted: at30Base.drafted.filter((pick) => pick.overallPick < 30)
    };
    const thirty = buildDraftStateFromFixture(players, at30, league, strategy);
    const thirtyFive = rankAt("fixtures/pick-35.json");
    expect(thirty.state.nextUserOverallPick).toBe(35);
    expect(thirtyFive.state.nextUserOverallPick).toBe(67);

    const shared = thirtyFive.shortlist[0]!.player;
    expect(
      computeNextPickRisk(35, 67, shared.adp, thirtyFive.state.recentPositionCounts[shared.position] ?? 0)
    ).toBeGreaterThan(
      computeNextPickRisk(30, 35, shared.adp, thirty.state.recentPositionCounts[shared.position] ?? 0)
    );
  });

  it("surfaces a conflict when fixture user keepers disagree with league config", () => {
    const league = loadLeagueConfig(leaguePath);
    const strategy = loadStrategyConfig(strategyPath);
    const players = loadSportslineWorkbook(sportslinePath);
    const fixture = loadDraftFixture("fixtures/pick-3.json");
    const conflicting = {
      ...fixture,
      keepers: fixture.keepers.filter((keeper) => keeper.fantasyTeam === league.userTeamName).slice(0, 1)
    };
    expect(() => buildDraftStateFromFixture(players, conflicting, league, strategy)).toThrow(EngineError);
  });

  it("walks the mock draft and ranks at each user turn", () => {
    const output = renderReplayDemo({
      scriptPath: "fixtures/pick-35.json",
      leaguePath,
      strategyPath,
      sportslinePath
    });
    expect(output).toMatch(/OUR TURN @ 3/);
    expect(output).toMatch(/OUR TURN @ 21/);
    expect(output).toMatch(/OUR TURN @ 30/);
    expect(output).toMatch(/OUR TURN @ 35/);
    expect(output).toMatch(/Pickens My Jeanty — Puka Nacua WR {2}<< our pick/);
    expect(output).toMatch(/1\. Hairy Butterscotch — Jahmyr Gibbs/);
  });

  it("prints a ranked shortlist from the pick-21 fixture CLI", async () => {
    const output = await rankFixture({
      fixturePath: "fixtures/pick-21.json",
      leaguePath,
      strategyPath,
      sportslinePath
    });
    expect(output).toMatch(/PICK 21/);
    expect(output).toMatch(/Pickens My Jeanty is on the clock/);
    expect(output).toMatch(/sportslineRating=/);
    expect(output).toMatch(/Ashton Jeanty/);
    expect(output).toMatch(/Fallback:/);
    expect(output).not.toMatch(/Jahmyr Gibbs/);
  });
});
