import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startCompanionServer } from "../src/companion/server.js";
import * as config from "../src/config/load.js";
import * as rosterGrid from "../src/data/rosterGrid.js";
import * as sportsline from "../src/data/sportsline.js";
import { compareFantasyProsRankings, importFantasyProsRankingsCsv } from "../src/data/fantasyProsRankings.js";
import { playerKey } from "../src/data/normalize.js";
import type { LeagueConfig, Position } from "../src/domain/types.js";

interface ServerHandle { port: number; close: () => void }

interface CompanionState {
  leagueName: string;
  userTeamName: string;
  teamCount: number;
  lineup: LeagueConfig["lineup"];
  keepers: { fantasyTeam: string; name: string; position: Position }[];
  knownOverallPicks: number[];
  round: number;
  upcomingPicks: { overallPick: number; fantasyTeam: string }[];
  currentOverallPick: number;
  draftedCount: number;
  picks: unknown[];
  userRoster: { name: string; position: Position; source: string }[];
  availablePlayers: {
    id: string; name: string; position: Position; rating: number;
    sportslineRating: number; fantasyProsRank: number | null;
  }[];
}

const expectedKeeperTeams: Record<string, [string, Position][]> = {
  "Chase'n my Puka": [["Puka Nacua", "WR"], ["Ja'Marr Chase", "WR"]],
  "Chubby Chasers": [["Jalen Hurts", "QB"], ["De'Von Achane", "RB"]],
  "Clyde": [["Josh Allen", "QB"], ["Drake London", "WR"]],
  "Dezzie Does Dallas": [["Christian McCaffrey", "RB"], ["A.J. Brown", "WR"]],
  "Doomsday Dingleberries": [["Travis Etienne", "RB"], ["Bhayshul Tuten", "RB"]],
  "F.A.F.O.": [["Quinshon Judkins", "RB"], ["Kenneth Walker III", "RB"]],
  "Gibbs me a win": [["Jahmyr Gibbs", "RB"], ["Chris Olave", "WR"]],
  "Gronk if you're horny": [["Breece Hall", "RB"], ["Malik Nabers", "WR"]],
  "Hairy Butterscotch": [["Omarion Hampton", "RB"], ["Amon-Ra St. Brown", "WR"]],
  "Kickin Bass": [["Kyren Williams", "RB"], ["Bijan Robinson", "RB"]],
  "NJigBA Please": [["CeeDee Lamb", "WR"], ["Jaxon Smith-Njigba", "WR"]],
  "Now we're Cookin'": [["James Cook", "RB"], ["Justin Jefferson", "WR"]],
  "Phil Belichick": [["Jonathan Taylor", "RB"], ["Derrick Henry", "RB"]],
  "Pickens My Jeanty": [["Ashton Jeanty", "RB"], ["George Pickens", "WR"]],
  "SUHK EM": [["Chase Brown", "RB"], ["Tee Higgins", "WR"]],
  "Yo Mama": [["Lamar Jackson", "QB"], ["Saquon Barkley", "RB"]]
};
const expectedKeepers = Object.entries(expectedKeeperTeams).flatMap(([fantasyTeam, players]) =>
  players.map(([name, position]) => ({ fantasyTeam, name, position })));

let server: ServerHandle | null = null;

async function fetchJson(url: string, options?: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, options);
  return { status: res.status, body: await res.json() };
}

beforeEach(async () => {
  vi.stubEnv("COMPANION_ROSTERGRID_CSV", undefined);
  vi.stubEnv("LEAGUE_CONFIG", "config/league.current.json");
  vi.stubEnv("STRATEGY_CONFIG", "config/strategy.current.json");
  vi.stubEnv("SPORTSLINE_XLSX", "data/reference/cheatsheet_cbsppr12.xlsx");
  vi.stubEnv("FANTASY_PROS_RANKINGS_CSV", "FantasyPros_2026_Draft_ALL_Rankings.csv");
  const handle = await startCompanionServer(0);
  server = handle;
  // Reset session via the API to ensure clean state.
  const reset = await fetch(`http://127.0.0.1:${server.port}/api/reset`, { method: "POST" });
  expect(reset.status).toBe(200);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (server) {
    server.close();
    server = null;
  }
});

// These integration cases rebuild both real provider imports several times.
describe("companion server", { timeout: 15000 }, () => {
  it("serves index.html at /", async () => {
    const res = await fetch(`http://127.0.0.1:${server!.port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain("Draft Companion");
  });

  it("serves static assets", async () => {
    const css = await fetch(`http://127.0.0.1:${server!.port}/style.css`);
    expect(css.status).toBe(200);
    const js = await fetch(`http://127.0.0.1:${server!.port}/app.js`);
    expect(js.status).toBe(200);
  });

  it("returns initial state with empty draft", async () => {
    const { status, body } = await fetchJson(`http://127.0.0.1:${server!.port}/api/state`);
    expect(status).toBe(200);
    const state = body as { draftedCount: number; currentOverallPick: number; teamOnClock: string; source: string; picks: unknown[] };
    expect(state.draftedCount).toBe(0);
    expect(state.currentOverallPick).toBe(1);
    expect(state.teamOnClock).toBe("Hairy Butterscotch");
    expect(state.picks).toEqual([]);
    expect(state.source).toBe("fantasypros");
    const metadata = body as CompanionState;
    expect(metadata.leagueName).toBe("All in the Family FFBL");
    expect(metadata.userTeamName).toBe("Pickens My Jeanty");
    expect(metadata.teamCount).toBe(16);
    expect(metadata.lineup).toEqual({ QB: 1, RB: 2, WR: 3, TE: 1, K: 1, DST: 1 });
    expect(metadata.knownOverallPicks).toEqual([3, 21, 30, 35, 67, 94, 99, 126, 131, 158]);
    expect(metadata.round).toBe(1);
    expect(metadata.upcomingPicks).toEqual([
      { overallPick: 1, fantasyTeam: "Hairy Butterscotch" },
      { overallPick: 2, fantasyTeam: "Gibbs me a win" },
      { overallPick: 3, fantasyTeam: "Pickens My Jeanty" },
      { overallPick: 4, fantasyTeam: "Chase'n my Puka" },
      { overallPick: 5, fantasyTeam: "Chubby Chasers" },
      { overallPick: 6, fantasyTeam: "Clyde" }
    ]);
  });

  it("records a pick and advances state", async () => {
    const { body: rec } = await fetchJson(`http://127.0.0.1:${server!.port}/api/recommend`);
    const firstId = (rec as { recommendations: { playerId: string }[] }).recommendations[0]!.playerId;
    const { body: pickResult } = await fetchJson(`http://127.0.0.1:${server!.port}/api/picks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: firstId })
    });
    const pick = pickResult as { ok: boolean; pick: { overallPick: number; fantasyTeam: string } };
    expect(pick.ok).toBe(true);
    expect(pick.pick.overallPick).toBe(1);
    expect(pick.pick.fantasyTeam).toBe("Hairy Butterscotch");

    const { body: state } = await fetchJson(`http://127.0.0.1:${server!.port}/api/state`);
    const s = state as { draftedCount: number; currentOverallPick: number; teamOnClock: string };
    expect(s.draftedCount).toBe(1);
    expect(s.currentOverallPick).toBe(2);
    expect(s.teamOnClock).toBe("Gibbs me a win");
  });

  it("undoes a pick", async () => {
    const { body: rec } = await fetchJson(`http://127.0.0.1:${server!.port}/api/recommend`);
    const firstId = (rec as { recommendations: { playerId: string }[] }).recommendations[0]!.playerId;
    await fetchJson(`http://127.0.0.1:${server!.port}/api/picks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: firstId })
    });
    await fetchJson(`http://127.0.0.1:${server!.port}/api/undo`, { method: "POST" });
    const { body: state } = await fetchJson(`http://127.0.0.1:${server!.port}/api/state`);
    const s = state as { draftedCount: number };
    expect(s.draftedCount).toBe(0);
  });

  it("rejects unknown player", async () => {
    const { status } = await fetchJson(`http://127.0.0.1:${server!.port}/api/picks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: "fake::WR" })
    });
    expect(status).toBe(400);
  });

  it("switches source between fantasypros and sportsline", async () => {
    const { body: a } = await fetchJson(`http://127.0.0.1:${server!.port}/api/source`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "sportsline" })
    });
    expect((a as { source: string }).source).toBe("sportsline");
    const { body: state } = await fetchJson(`http://127.0.0.1:${server!.port}/api/state`);
    expect((state as { source: string }).source).toBe("sportsline");
  });

  it("resets session", async () => {
    const { body: rec } = await fetchJson(`http://127.0.0.1:${server!.port}/api/recommend`);
    const firstId = (rec as { recommendations: { playerId: string }[] }).recommendations[0]!.playerId;
    await fetchJson(`http://127.0.0.1:${server!.port}/api/picks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: firstId })
    });
    await fetchJson(`http://127.0.0.1:${server!.port}/api/reset`, { method: "POST" });
    const { body: state } = await fetchJson(`http://127.0.0.1:${server!.port}/api/state`);
    expect((state as { draftedCount: number }).draftedCount).toBe(0);
  });

  it("returns recommend with explanation notes", async () => {
    const { body } = await fetchJson(`http://127.0.0.1:${server!.port}/api/recommend`);
    const rec = body as { recommendations: { notes: string[]; score: number }[] };
    expect(rec.recommendations.length).toBeGreaterThan(0);
    for (const r of rec.recommendations) {
      expect(r.notes.length).toBeGreaterThan(0);
      expect(r.score).toBeGreaterThan(0);
    }
  });

  it.each(["fantasypros", "sportsline"])("excludes all 32 keepers with authoritative ownership in %s", async (source) => {
    await fetchJson(`http://127.0.0.1:${server!.port}/api/source`, {
      method: "POST", body: JSON.stringify({ source })
    });
    const { body } = await fetchJson(`http://127.0.0.1:${server!.port}/api/state`);
    const state = body as CompanionState;
    expect(state.keepers).toHaveLength(32);
    expect(state.keepers).toEqual(expect.arrayContaining(expectedKeepers));
    for (const fantasyTeam of Object.keys(expectedKeeperTeams)) {
      expect(state.keepers.filter((keeper) => keeper.fantasyTeam === fantasyTeam)).toHaveLength(2);
    }
    const availableIds = new Set(state.availablePlayers.map((p) => p.id));
    for (const keeper of expectedKeepers) {
      const id = playerKey(keeper.name, keeper.position);
      expect(availableIds.has(id), keeper.name).toBe(false);
      const { status } = await fetchJson(`http://127.0.0.1:${server!.port}/api/picks`, {
        method: "POST", body: JSON.stringify({ playerId: id })
      });
      expect(status, keeper.name).toBe(400);
    }
    expect(availableIds.has(playerKey("Josh Jacobs", "RB"))).toBe(true);
    expect(state.userRoster).toEqual([
      { name: "Ashton Jeanty", position: "RB", source: "keeper" },
      { name: "George Pickens", position: "WR", source: "keeper" }
    ]);
  });

  it("rejects a stale expectedOverallPick without changing the draft or availability", async () => {
    const base = `http://127.0.0.1:${server!.port}`;
    const { body } = await fetchJson(`${base}/api/state`);
    const [first, second] = (body as CompanionState).availablePlayers;
    const accepted = await fetchJson(`${base}/api/picks`, {
      method: "POST", body: JSON.stringify({ playerId: first!.id, expectedOverallPick: 1 })
    });
    expect(accepted.status).toBe(200);
    const before = await fetchJson(`${base}/api/state`);
    const stale = await fetchJson(`${base}/api/picks`, {
      method: "POST", body: JSON.stringify({ playerId: second!.id, expectedOverallPick: 1 })
    });
    expect(stale).toEqual({
      status: 409,
      body: { ok: false, error: "Draft has advanced. Refresh state before recording a pick.", currentOverallPick: 2 }
    });
    expect(await fetchJson(`${base}/api/state`)).toEqual(before);
    const acceptedNext = await fetchJson(`${base}/api/picks`, {
      method: "POST", body: JSON.stringify({ playerId: second!.id, expectedOverallPick: 2 })
    });
    expect(acceptedNext.status).toBe(200);
  });

  it("reports the round and six upcoming owners across a snake turn and traded pick", async () => {
    const base = `http://127.0.0.1:${server!.port}`;
    const { body } = await fetchJson(`${base}/api/state`);
    for (const player of (body as CompanionState).availablePlayers.slice(0, 16)) {
      const { status } = await fetchJson(`${base}/api/picks`, {
        method: "POST", body: JSON.stringify({ playerId: player.id })
      });
      expect(status).toBe(200);
    }
    const { body: next } = await fetchJson(`${base}/api/state`);
    expect((next as CompanionState).round).toBe(2);
    expect((next as CompanionState).upcomingPicks).toEqual([
      { overallPick: 17, fantasyTeam: "Yo Mama" },
      { overallPick: 18, fantasyTeam: "SUHK EM" },
      { overallPick: 19, fantasyTeam: "NJigBA Please" },
      { overallPick: 20, fantasyTeam: "Phil Belichick" },
      { overallPick: 21, fantasyTeam: "Pickens My Jeanty" },
      { overallPick: 22, fantasyTeam: "Kickin Bass" }
    ]);
  });

  it("exposes original ratings and comparison-matched nullable ranks without changing source ratings", async () => {
    const sl = sportsline.loadSportslineWorkbook(process.env.SPORTSLINE_XLSX!);
    const fp = importFantasyProsRankingsCsv(process.env.FANTASY_PROS_RANKINGS_CSV!).players;
    const comparison = compareFantasyProsRankings(fp, sl);
    const ranks = new Map(comparison.matches.map((row) => [row.sportsline!.id, row.fantasyPros.ecrRank]));
    const original = new Map(sl.map((player) => [player.id, player.sportslineRating]));
    const strategyRanks = new Map(fp.map((player) => [playerKey(player.name, player.position), player.ecrRank]));
    const max = Math.max(...fp.map((player) => player.ecrRank));
    for (const source of ["fantasypros", "sportsline"]) {
      await fetchJson(`http://127.0.0.1:${server!.port}/api/source`, {
        method: "POST", body: JSON.stringify({ source })
      });
      const { body } = await fetchJson(`http://127.0.0.1:${server!.port}/api/state`);
      const players = (body as CompanionState).availablePlayers;
      expect(players.some((p) => p.fantasyProsRank === null)).toBe(true);
      expect(players.some((p) => p.fantasyProsRank !== null && !strategyRanks.has(p.id))).toBe(true);
      for (const player of players) {
        expect(player.sportslineRating).toBe(original.get(player.id));
        expect(player.fantasyProsRank).toBe(ranks.get(player.id) ?? null);
        const ecr = strategyRanks.get(player.id);
        const expectedRating = source === "sportsline" ? original.get(player.id)
          : ecr == null ? 0 : Math.round((1 - (ecr - 1) / Math.max(1, max - 1)) * 100);
        expect(player.rating).toBe(expectedRating);
      }
    }
  });

  it("uses the environment grid override and fails rather than falling back when it is unreadable", async () => {
    vi.stubEnv("COMPANION_ROSTERGRID_CSV", "docs/missing-companion-grid.csv");
    const { status, body } = await fetchJson(`http://127.0.0.1:${server!.port}/api/reset`, { method: "POST" });
    expect(status).toBe(500);
    expect((body as { error: string }).error).toContain("missing-companion-grid.csv");
    const grid = rosterGrid.loadRosterGrid("docs/roster-grid (1).csv");
    const load = vi.spyOn(rosterGrid, "loadRosterGrid").mockReturnValue(grid);
    expect((await fetchJson(`http://127.0.0.1:${server!.port}/api/state`)).status).toBe(200);
    expect(load).toHaveBeenCalledWith("docs/missing-companion-grid.csv");
  });

  it.each([
    ["unknown player", "Cannot uniquely resolve keeper"],
    ["wrong position", "Cannot uniquely resolve keeper"],
    ["unknown team", "Unknown keeper team"],
    ["duplicate player", "Duplicate keeper"],
    ["duplicate team", "Duplicate keeper team"],
    ["missing player", "Expected 2 keepers"],
    ["missing team", "Expected 16 keeper teams"]
  ])("fails loudly for a grid with %s", async (problem, error) => {
    const grid = rosterGrid.loadRosterGrid("docs/roster-grid (1).csv");
    const first = grid.teams[0]!;
    switch (problem) {
      case "unknown player": first.starters.WR![0]!.name = "Nobody Unknown"; break;
      case "wrong position": first.starters = { QB: first.starters.WR }; break;
      case "unknown team": first.teamName = "Unknown Team"; break;
      case "duplicate player": first.starters.WR![1] = first.starters.WR![0]!; break;
      case "duplicate team": grid.teams.push(first); break;
      case "missing player": first.starters.WR!.pop(); break;
      case "missing team": grid.teams.pop(); break;
    }
    vi.spyOn(rosterGrid, "loadRosterGrid").mockReturnValue(grid);
    const result = await fetchJson(`http://127.0.0.1:${server!.port}/api/reset`, { method: "POST" });
    expect(result.status).toBe(500);
    expect((result.body as { error: string }).error).toContain(error);
    expect((await fetchJson(`http://127.0.0.1:${server!.port}/api/state`)).status).toBe(500);
  });

  it("rejects ambiguous keeper identities rather than taking the first match", async () => {
    const players = sportsline.loadSportslineWorkbook(process.env.SPORTSLINE_XLSX!);
    players.push({ ...players.find((player) => player.name === "Puka Nacua")! });
    vi.spyOn(sportsline, "loadSportslineWorkbook").mockReturnValue(players);
    const result = await fetchJson(`http://127.0.0.1:${server!.port}/api/reset`, { method: "POST" });
    expect(result.status).toBe(500);
    expect((result.body as { error: string }).error).toContain('Cannot uniquely resolve keeper "P Nacua"');
  });

  it("does not merge config keepers, read JSON, or exclude trade names when the grid is configured", async () => {
    const league = config.loadLeagueConfig("config/league.current.json");
    league.keepers = [{ name: "Brock Bowers", position: "TE" }];
    league.leagueKeepersPath = "package.json";
    league.completedTrades = [{
      description: "Trade history must not override the keeper grid",
      sentPlayers: ["Josh Jacobs"], sentOverallPicks: [62], receivedOverallPicks: [21]
    }];
    vi.spyOn(config, "loadLeagueConfig").mockReturnValue(league);
    expect((await fetchJson(`http://127.0.0.1:${server!.port}/api/reset`, { method: "POST" })).status).toBe(200);
    const { body } = await fetchJson(`http://127.0.0.1:${server!.port}/api/state`);
    const state = body as CompanionState;
    expect(state.keepers).toHaveLength(32);
    expect(state.keepers).toEqual(expect.arrayContaining(expectedKeepers));
    expect(state.userRoster).toEqual([
      { name: "Ashton Jeanty", position: "RB", source: "keeper" },
      { name: "George Pickens", position: "WR", source: "keeper" }
    ]);
    expect(state.availablePlayers.map((player) => player.name)).toEqual(expect.arrayContaining(["Brock Bowers", "Josh Jacobs"]));
  });

  it("uses validated JSON plus user config only when no grid is configured", async () => {
    const league = config.loadLeagueConfig("config/league.current.json");
    delete league.rosterGridPath;
    vi.spyOn(config, "loadLeagueConfig").mockReturnValue(league);
    const loadGrid = vi.spyOn(rosterGrid, "loadRosterGrid");
    expect((await fetchJson(`http://127.0.0.1:${server!.port}/api/reset`, { method: "POST" })).status).toBe(200);
    const { body } = await fetchJson(`http://127.0.0.1:${server!.port}/api/state`);
    expect(loadGrid).not.toHaveBeenCalled();
    expect((body as CompanionState).keepers).toEqual([
      { fantasyTeam: "Pickens My Jeanty", name: "Ashton Jeanty", position: "RB" },
      { fantasyTeam: "Pickens My Jeanty", name: "George Pickens", position: "WR" },
      { fantasyTeam: "Now we're Cookin'", name: "Kenneth Walker III", position: "RB" }
    ]);
    league.leagueKeepersPath = "package.json";
    const invalid = await fetchJson(`http://127.0.0.1:${server!.port}/api/reset`, { method: "POST" });
    expect(invalid.status).toBe(500);
    expect((invalid.body as { error: string }).error).toContain("Invalid league keepers");
  });
});
