import { z } from "zod";
import { POSITIONS, RISK_FLAGS } from "../domain/types.js";

export const PositionSchema = z.enum(POSITIONS);

export const CompletedTradeSchema = z.object({
  description: z.string(),
  sentPlayers: z.array(z.string()),
  sentOverallPicks: z.array(z.number().int().positive()),
  receivedOverallPicks: z.array(z.number().int().positive())
});

export const LeagueConfigSchema = z.object({
  platform: z.literal("CBS"),
  season: z.number().int(),
  leagueName: z.string().min(1),
  userTeamName: z.string().min(1),
  fantasyDisplayName: z.string().min(1),
  teamCount: z.number().int().positive(),
  scoringFormat: z.enum(["PPR", "HALF_PPR", "NON_PPR"]),
  draftType: z.enum(["snake", "linear"]),
  draftTypeVerificationRequired: z.boolean(),
  draftSlot: z.number().int().positive(),
  keeperSlots: z.number().int().nonnegative(),
  keepers: z.array(
    z.object({
      name: z.string().min(1),
      position: PositionSchema
    })
  ),
  completedTrades: z.array(CompletedTradeSchema).default([]),
  knownOverallPicks: z.array(z.number().int().positive()),
  knownPicksArePartial: z.boolean(),
  lineup: z.object({
    QB: z.number().int().nonnegative(),
    RB: z.number().int().nonnegative(),
    WR: z.number().int().nonnegative(),
    TE: z.number().int().nonnegative(),
    K: z.number().int().nonnegative(),
    DST: z.number().int().nonnegative()
  }),
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

export const StrategyConfigSchema = z.object({
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
  kDstEligibleAfterOverallPick: z.number().int().nonnegative().default(130),
  byeOverlapPenalty: z.number().nonnegative().default(6),
  vorWeight: z.number().nonnegative().default(0),
  recentPickWindow: z.number().int().positive().default(8),
  softDraftPlan: z.record(z.string(), z.string()),
  notes: z.array(z.string())
});

export const FixtureKeeperSchema = z.object({
  name: z.string().min(1),
  position: PositionSchema,
  fantasyTeam: z.string().min(1)
});

export const FixturePickSchema = z.object({
  overallPick: z.number().int().positive(),
  fantasyTeam: z.string().min(1),
  playerName: z.string().min(1),
  position: PositionSchema.optional(),
  nflTeam: z.string().optional()
});

export const DraftFixtureSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  currentOverallPick: z.number().int().positive(),
  teamOnClock: z.string().nullable().optional(),
  keepers: z.array(FixtureKeeperSchema),
  drafted: z.array(FixturePickSchema)
});

export const DraftDecisionModelSchema = z.object({
  selectedCandidateId: z.string(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(600),
  alternativeCandidateIds: z.array(z.string()).max(4),
  riskFlags: z.array(z.enum(RISK_FLAGS))
});
