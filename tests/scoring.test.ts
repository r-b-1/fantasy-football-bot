import { describe, expect, it } from "vitest";
import { computeAdpValue, computeNextPickRisk } from "../src/engine/scoring.js";

describe("draft scoring helpers", () => {
  it("rewards a player who falls below ADP", () => {
    expect(computeAdpValue(60, 30)).toBeGreaterThan(computeAdpValue(30, 30));
  });

  it("penalizes a player drafted far earlier than ADP", () => {
    expect(computeAdpValue(20, 60)).toBeLessThan(50);
  });

  it("recognizes greater wait risk when next pick is far later", () => {
    expect(computeNextPickRisk(35, 67, 45)).toBeGreaterThan(computeNextPickRisk(30, 35, 45));
  });
});
