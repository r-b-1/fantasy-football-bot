import { z } from "zod";
import { POSITIONS } from "../domain/types.js";

const PositionSchema = z.enum(POSITIONS);

const SecretKey = /password|secret|api[_-]?key|cookie|token|authorization|credential/i;

export const DraftLogEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("draft_pick_seen"),
    overallPick: z.number().int().positive(),
    team: z.string(),
    playerId: z.string(),
    playerName: z.string(),
    position: PositionSchema.optional(),
    ts: z.string()
  }),
  z.object({
    type: z.literal("our_turn"),
    overallPick: z.number().int().positive(),
    ts: z.string()
  }),
  z.object({
    type: z.literal("recommendation"),
    overallPick: z.number().int().positive(),
    candidateId: z.string(),
    playerName: z.string(),
    score: z.number(),
    notes: z.array(z.string()),
    ts: z.string()
  }),
  z.object({
    type: z.literal("shortlist"),
    overallPick: z.number().int().positive(),
    candidateIds: z.array(z.string()),
    ts: z.string()
  }),
  z.object({
    type: z.literal("ai_decision"),
    overallPick: z.number().int().positive(),
    candidateId: z.string(),
    confidence: z.number(),
    source: z.enum(["ai", "deterministic_fallback"]),
    latencyMs: z.number().nonnegative().optional(),
    fallbackReason: z.string().optional(),
    ts: z.string()
  }),
  z.object({
    type: z.literal("projection"),
    overallPick: z.number().int().positive(),
    horizon: z.number().int().positive(),
    source: z.enum(["ai", "deterministic"]),
    picks: z.array(
      z.object({
        playerId: z.string(),
        playerName: z.string(),
        position: PositionSchema,
        expectedOverallPick: z.number().int().positive(),
        confidence: z.number()
      })
    ),
    fallbackReason: z.string().optional(),
    ts: z.string()
  }),
  z.object({
    type: z.literal("pick_submitted"),
    overallPick: z.number().int().positive(),
    candidateId: z.string(),
    playerName: z.string(),
    ts: z.string()
  }),
  z.object({
    type: z.literal("pick_verified"),
    overallPick: z.number().int().positive(),
    candidateId: z.string(),
    playerName: z.string(),
    ts: z.string()
  }),
  z.object({
    type: z.literal("execution_disabled"),
    reason: z.string(),
    ts: z.string()
  }),
  z.object({
    type: z.literal("config_conflict"),
    conflicts: z.array(z.string()),
    ts: z.string()
  })
]);

export type DraftLogEvent = z.infer<typeof DraftLogEventSchema>;

export function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([key]) => !SecretKey.test(key)
    );
    return Object.fromEntries(entries.map(([key, nested]) => [key, stripSecrets(nested)]));
  }
  return value;
}
