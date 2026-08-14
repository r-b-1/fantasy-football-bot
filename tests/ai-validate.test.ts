import { describe, expect, it } from "vitest";
import { validateModelDecision } from "../src/ai/validate.js";

const allowed = ["a::WR", "b::RB", "c::TE"];

const valid = {
  selectedCandidateId: "a::WR",
  confidence: 0.9,
  rationale: "Best remaining WR value",
  alternativeCandidateIds: ["b::RB"],
  riskFlags: ["NONE"]
};

describe("AI decision validator", () => {
  it("accepts a valid candidate choice", () => {
    const result = validateModelDecision(valid, allowed, 0.65);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.decision.selectedCandidateId).toBe("a::WR");
  });

  it("rejects an out-of-shortlist candidate ID", () => {
    const result = validateModelDecision(
      { ...valid, selectedCandidateId: "invented::QB" },
      allowed,
      0.65
    );
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate alternatives", () => {
    const result = validateModelDecision(
      { ...valid, alternativeCandidateIds: ["b::RB", "b::RB"] },
      allowed,
      0.65
    );
    expect(result.ok).toBe(false);
  });

  it("falls back below the confidence threshold", () => {
    const result = validateModelDecision({ ...valid, confidence: 0.2 }, allowed, 0.65);
    expect(result.ok).toBe(false);
  });

  it("rejects alternatives that are not in the shortlist", () => {
    const result = validateModelDecision(
      { ...valid, alternativeCandidateIds: ["outside::WR"] },
      allowed,
      0.65
    );
    expect(result.ok).toBe(false);
  });
});
