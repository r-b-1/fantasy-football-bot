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
