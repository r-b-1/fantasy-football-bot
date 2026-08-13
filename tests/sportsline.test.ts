import { describe, expect, it } from "vitest";
import { loadSportslineWorkbook } from "../src/data/sportsline.js";

describe("SportsLine importer", () => {
  it("loads real supplied workbook and expected positions", () => {
    const players = loadSportslineWorkbook("data/reference/cheatsheet_cbsppr12.xlsx");
    expect(players.length).toBeGreaterThan(100);
    expect(players.some((p) => p.name === "Ashton Jeanty" && p.position === "RB")).toBe(true);
    expect(players.some((p) => p.name === "George Pickens" && p.position === "WR")).toBe(true);
    expect(new Set(players.map((p) => p.id)).size).toBe(players.length);
  });
});
