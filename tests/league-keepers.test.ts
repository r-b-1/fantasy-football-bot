import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadLeagueConfig } from "../src/config/load.js";
import { loadLeagueKeepers, resolveProjectionKeepers } from "../src/data/leagueKeepers.js";
import { EngineError } from "../src/domain/errors.js";

const league = loadLeagueConfig("config/league.current.json");

describe("league keepers file", () => {
  it("loads JSON keepers including other teams", () => {
    const keepers = loadLeagueKeepers("config/league-keepers.json");
    expect(keepers.some((k) => k.playerName === "Kenneth Walker III")).toBe(true);
    expect(keepers.some((k) => k.fantasyTeam === "Now we're Cookin'")).toBe(true);
  });

  it("loads a CSV of fantasyTeam,name,position", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keepers-"));
    const file = path.join(dir, "keepers.csv");
    fs.writeFileSync(
      file,
      ["fantasyTeam,name,position", "Clyde,Josh Allen,QB", "Hairy Butterscotch,Jahmyr Gibbs,RB"].join("\n")
    );
    const keepers = loadLeagueKeepers(file);
    expect(keepers).toEqual([
      { fantasyTeam: "Clyde", playerName: "Josh Allen", position: "QB" },
      { fantasyTeam: "Hairy Butterscotch", playerName: "Jahmyr Gibbs", position: "RB" }
    ]);
  });

  it("merges the user's configured keepers when resolving for projection", () => {
    const resolved = resolveProjectionKeepers(league);
    expect(resolved.some((k) => k.playerName === "Ashton Jeanty")).toBe(true);
    expect(resolved.some((k) => k.playerName === "George Pickens")).toBe(true);
    expect(resolved.some((k) => k.playerName === "Kenneth Walker III")).toBe(true);
  });

  it("rejects a missing keepers file", () => {
    expect(() => loadLeagueKeepers("config/does-not-exist-keepers.json")).toThrow(EngineError);
  });
});
