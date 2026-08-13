import fs from "node:fs";
import { z } from "zod";
import { POSITIONS, type LeagueConfig, type StrategyConfig } from "../domain/types.js";

const PositionSchema = z.enum(POSITIONS);

const LeagueConfigSchema = z.object({
  platform: z.literal("CBS"),
  season: z.number().int(),
  leagueName: z.string(),
  userTeamName: z.string(),
  fantasyDisplayName: z.string(),
  teamCount: z.number().int().positive(),
  scoringFormat: z.enum(["PPR", "HALF_PPR", "NON_PPR"]),
  draftType: z.enum(["snake", "linear"]),
  draftTypeVerificationRequired: z.boolean(),
  draftSlot: z.number().int().positive(),
  keeperSlots: z.number().int().nonnegative(),
  keepers: z.array(z.object({ name: z.string(), position: PositionSchema })),
  completedTrades: z.array(z.unknown()).optional(),
  knownOverallPicks: z.array(z.number().int().positive()),
  knownPicksArePartial: z.boolean(),
  lineup: z.record(PositionSchema, z.number().int().nonnegative()),
  benchSlots: z.number().int().nonnegative().nullable(),
  rosterMaximums: z.object({
    QB: z.number().int().positive().optional(),
    RB: z.number().int().positive().optional(),
    WR: z.number().int().positive().optional(),
    TE: z.number().int().positive().optional(),
    K: z.number().int().positive().optional(),
    DST: z.number().int().positive().optional()
  }),
  executionMode: z.enum(["monitor", "recommend", "confirm", "autopilot"]),
  cbsExecutionEnabled: z.boolean(),
  notes: z.array(z.string())
});

const StrategyConfigSchema = z.object({
  candidateShortlistSize: z.number().int().min(1).max(20),
  aiConfidenceThreshold: z.number().min(0).max(1),
  aiTimeoutMs: z.number().int().positive(),
  minimumExecutionClockSeconds: z.number().int().nonnegative(),
  freshStateMaxAgeMs: z.number().int().positive(),
  weights: z.object({
    sportslineRating: z.number().nonnegative(),
    adpValue: z.number().nonnegative(),
    rosterNeed: z.number().nonnegative(),
    scarcity: z.number().nonnegative(),
    nextPickRisk: z.number().nonnegative(),
    tierCliff: z.number().nonnegative()
  }),
  earlyRoundPositionPenalties: z.object({
    QB: z.number().nonnegative().optional(),
    RB: z.number().nonnegative().optional(),
    WR: z.number().nonnegative().optional(),
    TE: z.number().nonnegative().optional(),
    K: z.number().nonnegative().optional(),
    DST: z.number().nonnegative().optional()
  }),
  softDraftPlan: z.record(z.string(), z.string()),
  notes: z.array(z.string())
});

function loadJson(path: string): unknown {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

export function loadLeagueConfig(path: string): LeagueConfig {
  return LeagueConfigSchema.parse(loadJson(path)) as LeagueConfig;
}

export function loadStrategyConfig(path: string): StrategyConfig {
  const cfg = StrategyConfigSchema.parse(loadJson(path));
  const sum = Object.values(cfg.weights).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 0.001) {
    throw new Error(`Strategy weights must sum to 1.0; got ${sum}`);
  }
  return cfg as StrategyConfig;
}
