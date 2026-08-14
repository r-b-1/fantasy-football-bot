import { noCandidates } from "../domain/errors.js";
import type { CandidateScore, DraftDecision } from "../domain/types.js";

export function deterministicDecision(candidates: CandidateScore[]): DraftDecision {
  if (candidates.length === 0) throw noCandidates();
  const [top, ...rest] = candidates;
  return {
    selectedCandidateId: top!.player.id,
    confidence: 1,
    rationale: "Deterministic top-ranked candidate",
    alternativeCandidateIds: rest.slice(0, 4).map((c) => c.player.id),
    riskFlags: ["NONE"],
    source: "deterministic_fallback",
    latencyMs: 0
  };
}
