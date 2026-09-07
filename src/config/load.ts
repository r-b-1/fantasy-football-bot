import fs from "node:fs";
import { EngineError } from "../domain/errors.js";
import type { LeagueConfig, StrategyConfig } from "../domain/types.js";
import { LeagueConfigSchema, StrategyConfigSchema } from "./schema.js";

function loadJson(path: string): unknown {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

export function loadLeagueConfig(path: string): LeagueConfig {
  const parsed = LeagueConfigSchema.safeParse(loadJson(path));
  if (!parsed.success) {
    throw new EngineError(
      "invalid_config",
      `Invalid league config at ${path}: ${parsed.error.message}`,
      { path, issues: parsed.error.issues }
    );
  }
  const cfg = parsed.data;
  if (cfg.keepers.length !== cfg.keeperSlots) {
    throw new EngineError(
      "invalid_config",
      `League keepers length (${cfg.keepers.length}) does not match keeperSlots (${cfg.keeperSlots})`,
      { path }
    );
  }
  if (cfg.draftSlot > cfg.teamCount) {
    throw new EngineError(
      "invalid_config",
      `draftSlot ${cfg.draftSlot} is outside teamCount ${cfg.teamCount}`,
      { path }
    );
  }
  if (cfg.executionMode === "autopilot" && !cfg.cbsExecutionEnabled) {
    throw new EngineError(
      "invalid_config",
      "executionMode=autopilot requires cbsExecutionEnabled=true",
      { path }
    );
  }
  if (cfg.draftOrder) {
    if (cfg.draftOrder.length !== cfg.teamCount) {
      throw new EngineError(
        "invalid_config",
        `draftOrder length (${cfg.draftOrder.length}) must equal teamCount (${cfg.teamCount})`,
        { path }
      );
    }
    const seenSlots = new Set<string>();
    for (const name of cfg.draftOrder) {
      const key = name.trim().toLowerCase();
      if (seenSlots.has(key)) {
        throw new EngineError("invalid_config", `draftOrder has duplicate team "${name}"`, { path });
      }
      seenSlots.add(key);
    }
  }
  const claimedPicks = new Map<number, string>();
  const seenTeams = new Set<string>();
  for (const entry of cfg.leaguePicks) {
    const teamKey = entry.teamName.trim().toLowerCase();
    if (seenTeams.has(teamKey)) {
      throw new EngineError(
        "invalid_config",
        `leaguePicks has duplicate team "${entry.teamName}"`,
        { path }
      );
    }
    seenTeams.add(teamKey);
    const inTeam = new Set<number>();
    for (const pick of entry.picks) {
      if (inTeam.has(pick)) {
        throw new EngineError(
          "invalid_config",
          `leaguePicks for "${entry.teamName}" repeats overall pick ${pick}`,
          { path }
        );
      }
      inTeam.add(pick);
      const previous = claimedPicks.get(pick);
      if (previous) {
        throw new EngineError(
          "invalid_config",
          `Overall pick ${pick} is assigned to both "${previous}" and "${entry.teamName}"`,
          { path }
        );
      }
      claimedPicks.set(pick, entry.teamName);
    }
  }
  if (!cfg.leaguePicksArePartial) {
    if (cfg.leaguePicks.length !== cfg.teamCount) {
      throw new EngineError(
        "invalid_config",
        `leaguePicksArePartial=false requires an entry for every team; got ${cfg.leaguePicks.length} of ${cfg.teamCount}`,
        { path }
      );
    }
  }
  return cfg;
}

export function loadStrategyConfig(path: string): StrategyConfig {
  const parsed = StrategyConfigSchema.safeParse(loadJson(path));
  if (!parsed.success) {
    throw new EngineError(
      "invalid_config",
      `Invalid strategy config at ${path}: ${parsed.error.message}`,
      { path, issues: parsed.error.issues }
    );
  }
  const cfg = parsed.data;
  const sum = Object.values(cfg.weights).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 0.001) {
    throw new EngineError(
      "invalid_config",
      `Strategy weights must sum to 1.0; got ${sum}`,
      { path, sum }
    );
  }
  return cfg;
}
