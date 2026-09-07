import { describe, expect, it } from "vitest";
import { loadLeagueConfig, loadStrategyConfig } from "../src/config/load.js";
import { EngineError } from "../src/domain/errors.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("config validation", () => {
  it("loads the current league and strategy files", () => {
    const league = loadLeagueConfig("config/league.current.json");
    const strategy = loadStrategyConfig("config/strategy.current.json");
    expect(league.teamCount).toBe(16);
    expect(league.userTeamName).toBe("Pickens My Jeanty");
    expect(league.executionMode).toBe("recommend");
    expect(league.cbsExecutionEnabled).toBe(false);
    expect(league.keepers.map((k) => k.name)).toEqual(["Ashton Jeanty", "George Pickens"]);
    expect(league.completedTrades).toHaveLength(1);
    expect(league.inferUserTeamFromYouAreUp).toBe(false);
    expect(strategy.candidateShortlistSize).toBe(7);
  });

  it("loads the public mock-draft league without keepers or live clicking", () => {
    const mock = loadLeagueConfig("config/league.mock.json");
    expect(mock.teamCount).toBe(12);
    expect(mock.keepers).toEqual([]);
    expect(mock.keeperSlots).toBe(0);
    expect(mock.cbsExecutionEnabled).toBe(false);
    expect(mock.executionMode).toBe("recommend");
    expect(mock.inferUserTeamFromYouAreUp).toBe(true);
  });

  it("rejects strategy weights that do not sum to 1", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-"));
    const file = path.join(dir, "strategy.json");
    const valid = JSON.parse(fs.readFileSync("config/strategy.current.json", "utf8")) as {
      weights: Record<string, number>;
    };
    valid.weights.sportslineRating = 0.99;
    fs.writeFileSync(file, JSON.stringify(valid));
    expect(() => loadStrategyConfig(file)).toThrow(EngineError);
  });

  it("rejects an invalid execution mode", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "league-"));
    const file = path.join(dir, "league.json");
    const valid = JSON.parse(fs.readFileSync("config/league.current.json", "utf8")) as {
      executionMode: string;
    };
    valid.executionMode = "yolo";
    fs.writeFileSync(file, JSON.stringify(valid));
    expect(() => loadLeagueConfig(file)).toThrow(EngineError);
  });
});
