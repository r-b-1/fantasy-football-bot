import { afterEach, describe, expect, it, vi } from "vitest";
import { previewFantasyProsRankings } from "../src/cli/fantasyProsRankings.js";
import {
  compareFantasyProsRankings, importFantasyProsRankingsCsv, parseFantasyProsRankingsCsv
} from "../src/data/fantasyProsRankings.js";
import { playerKey } from "../src/data/normalize.js";
import { loadSportslineWorkbook } from "../src/data/sportsline.js";
import type { Position, SportslinePlayer } from "../src/domain/types.js";

const csvPath = "FantasyPros_2026_Draft_ALL_Rankings.csv";
const workbookPath = "data/reference/cheatsheet_cbsppr12.xlsx";
const header = '"RK",TIERS,"PLAYER NAME",TEAM,"POS","BYE WEEK","ECR VS. ADP"';
const csv = (...rows: string[]) => [header, ...rows].join("\n");
const player = (name: string, position: Position = "RB", adp: number | null = 17.5): SportslinePlayer => ({
  id: playerKey(name, position), name, sourceName: name, position,
  sportslineRating: 98.75, adp, listedRound: 2, byeWeek: 7
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("offline FantasyPros CSV import", () => {
  it("imports all supplied rankings, separators, suffixes, DST and missing byes", () => {
    const result = importFantasyProsRankingsCsv(csvPath);
    expect(result).toMatchObject({
      source: "FantasyPros", scoringFormat: "unverified", usage: "comparison-only", skippedBlankRows: 2
    });
    expect(result.players).toHaveLength(543);
    expect(result.players.map((entry) => entry.ecrRank)).toEqual(Array.from({ length: 543 }, (_, i) => i + 1));
    expect(result.players[0]).toEqual({
      ecrRank: 1, tier: 1, name: "Ja'Marr Chase", team: "CIN", position: "WR", positionRank: 1, byeWeek: 6
    });
    expect(result.players[12].name).toBe("James Cook III");
    expect(result.players[44].name).toBe("Travis Etienne Jr.");
    expect(result.players[154]).toMatchObject({ name: "Houston Texans", position: "DST", positionRank: 1 });
    expect(result.players[307]).toMatchObject({ name: "Devin Neal", team: "FA", byeWeek: null });
    expect(result.players[542]).toMatchObject({ name: "Jermaine Burton", ecrRank: 543 });
    expect(result.duplicates).toEqual([{ key: "isaiah williams::WR", ecrRanks: [416, 455] }]);
    expect(result.players.every((entry) => !("adp" in entry) && !("sportslineRating" in entry))).toBe(true);
  });

  it("handles quoted commas, escaped quotes, CRLF, blank and tier-only separators", () => {
    const result = parseFantasyProsRankingsCsv(csv(
      '"1",1,"John ""Jet"", Smith",FA,WR1,-,+99',
      ",1", ",,,,,,", '2,1,"Other Player",BUF,RB1,7,-22'
    ).replace(/\n/g, "\r\n"));
    expect(result.players).toHaveLength(2);
    expect(result.players[0].name).toBe('John "Jet", Smith');
    expect(result.players[0].byeWeek).toBeNull();
    expect(result.skippedBlankRows).toBe(2);
  });

  it("reports normalized identity and ECR duplicates while retaining every ranked row", () => {
    const result = parseFantasyProsRankingsCsv(csv(
      "1,1,James Cook,BUF,RB1,7,+2", "2,1, james cook ,BUF,RB2,7,-1",
      "2,1,Other Player,BUF,WR1,7,-"
    ));
    expect(result.players).toHaveLength(3);
    expect(result.duplicates).toEqual([
      { key: "james cook::RB", ecrRanks: [1, 2] }, { key: "ECR::2", ecrRanks: [2, 2] }
    ]);
  });

  it.each([
    ",1,James Cook,BUF,RB1,7,+2", "oops,1,James Cook,BUF,RB1,7,+2",
    "1.5,1,James Cook,BUF,RB1,7,+2", "0,1,James Cook,BUF,RB1,7,+2",
    "1,,James Cook,BUF,RB1,7,+2", "1,1,,BUF,RB1,7,+2",
    "1,1,James Cook,,RB1,7,+2", "1,1,James Cook,BUF,RB,7,+2",
    "1,1,James Cook,BUF,RB0,7,+2", "1,1,James Cook,BUF,LB1,7,+2",
    "1,1,James Cook,BUF,RB1,nope,+2", "1,1,James Cook,BUF,RB1,19,+2",
    "1,1", ",1,,BUF,,,+2"
  ])("rejects malformed rows rather than silently skipping: %s", (row) => {
    expect(() => parseFantasyProsRankingsCsv(csv(row))).toThrow(/FantasyPros CSV row 2:/);
  });

  it("rejects missing headers", () => {
    expect(() => parseFantasyProsRankingsCsv("rank,name\n1,James Cook")).toThrow(/missing headers: RK/);
  });
});

describe("FantasyPros comparison", () => {
  it("matches exact identities, DST aliases and unique suffix variants without changing SportsLine", () => {
    const rankings = parseFantasyProsRankingsCsv(csv(
      "1,1,James Cook III,BUF,RB1,7,+500", "2,1,Travis Etienne Jr.,NO,RB2,8,-200",
      "3,1,Houston Texans,HOU,DST1,8,-", "4,1,Exact Player,BUF,WR1,7,+1"
    )).players;
    const sportsline = [player("James Cook"), player("Travis Etienne", "RB", null),
      player("Texans", "DST"), player("Exact Player", "WR"), player("SportsLine Only")];
    const before = structuredClone({ rankings, sportsline });
    sportsline.forEach(Object.freeze);
    rankings.forEach(Object.freeze);
    const result = compareFantasyProsRankings(Object.freeze(rankings), Object.freeze(sportsline));
    expect(result.matches).toHaveLength(4);
    expect(result.unmatchedFantasyPros).toEqual([]);
    expect(result.unmatchedSportsline).toEqual([sportsline[4]]);
    result.matches.forEach((match, i) => expect(match.sportsline).toBe(sportsline[i]));
    expect(result.rows[1].sportsline?.adp).toBeNull();
    expect({ rankings, sportsline }).toEqual(before);
  });

  it("leaves ambiguous suffixes and duplicate SportsLine identities unmatched", () => {
    const rankings = parseFantasyProsRankingsCsv(csv(
      "1,1,James Cook III,BUF,RB1,7,+2", "2,1,Travis Etienne,NO,RB2,8,-"
    )).players;
    const sportsline = [player("James Cook"), player("James Cook Jr."),
      player("Travis Etienne"), player("Travis Etienne")];
    const result = compareFantasyProsRankings(rankings, sportsline);
    expect(result.matches).toEqual([]);
    expect(result.unmatchedFantasyPros).toEqual(rankings);
    expect(result.unmatchedSportsline).toEqual(sportsline);
  });

  it("does not let multiple CSV entries claim one SportsLine player", () => {
    const rankings = parseFantasyProsRankingsCsv(csv(
      "1,1,James Cook,BUF,RB1,7,+2", "2,1,James Cook III,BUF,RB2,7,-",
      "3,1,Isaiah Williams,NYJ,WR1,13,-", "4,1,Isaiah Williams,FA,WR2,-,-"
    )).players;
    const result = compareFantasyProsRankings(rankings, [player("James Cook"), player("Isaiah Williams", "WR")]);
    expect(result.matches).toEqual([]);
    expect(result.unmatchedFantasyPros).toHaveLength(4);
  });

  it("does not guess initials, surnames, nicknames or different positions", () => {
    const rankings = parseFantasyProsRankingsCsv(csv(
      "1,1,J. Cook,BUF,RB1,7,-", "2,1,Cook,BUF,RB2,7,-",
      "3,1,Kenny Gainwell,TB,RB3,10,-", "4,1,James Cook,BUF,WR1,7,-"
    )).players;
    expect(compareFantasyProsRankings(rankings, [player("James Cook"), player("Kenneth Gainwell")]).matches).toEqual([]);
  });

  it("compares the full supplied files and preserves every SportsLine object", () => {
    const imported = importFantasyProsRankingsCsv(csvPath);
    const sportsline = loadSportslineWorkbook(workbookPath);
    const before = structuredClone(sportsline);
    const result = compareFantasyProsRankings(imported.players, sportsline);
    expect(sportsline).toHaveLength(674);
    expect(result.rows).toHaveLength(543);
    expect(result.matches).toHaveLength(487);
    expect(result.unmatchedFantasyPros).toHaveLength(56);
    expect(result.unmatchedSportsline).toHaveLength(187);
    expect(result.matches.length + result.unmatchedFantasyPros.length).toBe(543);
    expect(result.matches.length + result.unmatchedSportsline.length).toBe(sportsline.length);
    expect(result.matches.find((row) => row.fantasyPros.name === "James Cook III")?.sportsline?.name).toBe("James Cook");
    expect(result.matches.find((row) => row.fantasyPros.name === "Travis Etienne Jr.")?.sportsline?.name).toBe("Travis Etienne");
    for (const row of result.matches) expect(sportsline).toContain(row.sportsline);
    expect(sportsline).toEqual(before);
  });
});

describe("offline comparison CLI", () => {
  it("prints full counts, top 20, attribution and caveats without making API requests", () => {
    vi.stubEnv("FANTASY_PROS_RANKINGS_CSV", csvPath);
    vi.stubEnv("SPORTSLINE_XLSX", workbookPath);
    const fetch = vi.fn(() => { throw new Error("Network forbidden"); });
    vi.stubGlobal("fetch", fetch);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const table = vi.spyOn(console, "table").mockImplementation(() => {});
    previewFantasyProsRankings([]);
    const output = log.mock.calls.flat().join("\n");
    expect(output).toContain("FantasyPros: 543 ranked rows, 2 blank/separator rows skipped, 1 duplicate groups.");
    expect(output).toContain("Scoring format: unverified");
    expect(output).toContain("PPR is not assumed");
    expect(output).toContain("API requests: 0");
    expect(output).toContain("https://www.fantasypros.com/");
    expect(output).toContain("not a filtered draft-availability board");
    expect(output).toContain("SportsLine: 674 players, 358 blank rows skipped. Matched: 487.");
    expect(output).toContain("Unmatched FantasyPros: 56.");
    expect(output).toContain("Unmatched SportsLine: 187.");
    expect(table.mock.calls[0][0]).toHaveLength(20);
    expect(table.mock.calls[0][0][0]).toEqual({
      ECR: 1, Tier: 1, Player: "Ja'Marr Chase", Position: "WR1",
      "SportsLine Rating": 93, "SportsLine ADP": 8.17
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects refresh/network flags and extra arguments", () => {
    expect(() => previewFantasyProsRankings(["--refresh"])).toThrow(/Usage:/);
    expect(() => previewFantasyProsRankings(["one.csv", "two.csv"])).toThrow(/Usage:/);
  });
});
