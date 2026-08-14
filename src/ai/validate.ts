import type { DraftDecision } from "../domain/types.js";
import { DraftDecisionModelSchema } from "../config/schema.js";

export type DecisionValidation =
  | { ok: true; decision: Omit<DraftDecision, "source" | "latencyMs" | "fallbackReason"> }
  | { ok: false; reason: string };

export function validateModelDecision(
  parsed: unknown,
  allowedIds: string[],
  confidenceThreshold: number
): DecisionValidation {
  const result = DraftDecisionModelSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, reason: `invalid structured output: ${result.error.message}` };
  }

  const allowed = new Set(allowedIds);
  const decision = result.data;

  if (!allowed.has(decision.selectedCandidateId)) {
    return {
      ok: false,
      reason: `selectedCandidateId ${decision.selectedCandidateId} is not in the shortlist`
    };
  }

  const alternatives = decision.alternativeCandidateIds;
  if (new Set(alternatives).size !== alternatives.length) {
    return { ok: false, reason: "alternativeCandidateIds contains duplicates" };
  }
  if (alternatives.includes(decision.selectedCandidateId)) {
    return { ok: false, reason: "alternativeCandidateIds must not include the selected candidate" };
  }
  const outside = alternatives.filter((id) => !allowed.has(id));
  if (outside.length > 0) {
    return {
      ok: false,
      reason: `alternativeCandidateIds outside shortlist: ${outside.join(", ")}`
    };
  }
  if (decision.confidence < confidenceThreshold) {
    return {
      ok: false,
      reason: `confidence ${decision.confidence} is below threshold ${confidenceThreshold}`
    };
  }

  return { ok: true, decision };
}
