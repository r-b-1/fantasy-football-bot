import fs from "node:fs";
import { EngineError } from "../domain/errors.js";
import type { DraftFixture } from "../domain/types.js";
import { DraftFixtureSchema } from "../config/schema.js";

export function loadDraftFixture(path: string): DraftFixture {
  const parsed = DraftFixtureSchema.safeParse(JSON.parse(fs.readFileSync(path, "utf8")));
  if (!parsed.success) {
    throw new EngineError(
      "invalid_fixture",
      `Invalid draft fixture at ${path}: ${parsed.error.message}`,
      { path, issues: parsed.error.issues }
    );
  }
  const seenPicks = new Set<number>();
  for (const pick of parsed.data.drafted) {
    if (seenPicks.has(pick.overallPick)) {
      throw new EngineError(
        "invalid_fixture",
        `Fixture ${path} has duplicate overall pick ${pick.overallPick}`,
        { path, overallPick: pick.overallPick }
      );
    }
    seenPicks.add(pick.overallPick);
  }
  return parsed.data;
}
