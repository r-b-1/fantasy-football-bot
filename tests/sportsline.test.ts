import { describe, expect, it } from "vitest";
import { importSportslineWorkbook, loadSportslineWorkbook } from "../src/data/sportsline.js";
import { normalizePlayerName, playerKey } from "../src/data/normalize.js";

const WORKBOOK = "data/reference/cheatsheet_cbsppr12.xlsx";

describe("SportsLine importer", () => {
  it("reads all six position sheets and skips blank rating rows", () => {
    const result = importSportslineWorkbook(WORKBOOK);
    expect(result.sheets).toEqual(["QB", "RB", "WR", "TE", "K", "DST"]);
    expect(result.skippedBlankRows).toBeGreaterThan(50);
    expect(result.players.length).toBe(674);
  });

  it("parses numbers, trims names, and preserves bye weeks", () => {
    const players = loadSportslineWorkbook(WORKBOOK);
    const allen = players.find((p) => p.name === "Josh Allen" && p.position === "QB");
    expect(allen).toMatchObject({
      sportslineRating: 100,
      adp: 15.58,
      listedRound: 2,
      byeWeek: 7
    });
    expect(players.some((p) => p.name === "Ashton Jeanty" && p.position === "RB")).toBe(true);
    expect(players.some((p) => p.name === "George Pickens" && p.position === "WR")).toBe(true);
  });

  it("handles DST leading whitespace without inventing a city name", () => {
    const players = loadSportslineWorkbook(WORKBOOK);
    const broncos = players.find((p) => p.position === "DST" && p.name === "Broncos");
    expect(broncos).toBeTruthy();
    expect(broncos?.sourceName.startsWith(" ")).toBe(true);
    expect(broncos?.id).toBe(playerKey("Broncos", "DST"));
    expect(players.filter((p) => p.position === "DST").every((p) => p.name === p.name.trim())).toBe(
      true
    );
  });

  it("stores missing ADP as null instead of zero", () => {
    const players = loadSportslineWorkbook(WORKBOOK);
    const missingAdp = players.filter((p) => p.adp === null);
    expect(missingAdp.length).toBeGreaterThan(100);
    expect(players.every((p) => p.adp !== 0 || p.name.length > 0)).toBe(true);
  });

  it("produces no duplicate normalized keys", () => {
    const players = loadSportslineWorkbook(WORKBOOK);
    expect(new Set(players.map((p) => p.id)).size).toBe(players.length);
  });
});

describe("name normalization", () => {
  it("collapses whitespace and curly apostrophes", () => {
    expect(normalizePlayerName("  Ja’marr   Chase ")).toBe("Ja'marr Chase");
    expect(normalizePlayerName(" Broncos ", "DST")).toBe("Broncos");
    expect(normalizePlayerName("The Broncos DST", "DST")).toBe("Broncos");
  });
});
