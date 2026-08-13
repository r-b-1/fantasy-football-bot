import fs from "node:fs";
import { z } from "zod";

const NullableString = z.string().nullable();
const SelectorConfigSchema = z.object({
  status: z.string(),
  instructions: z.string(),
  draftRoomUrlPattern: z.string(),
  selectors: z.object({
    currentPick: NullableString,
    teamOnClock: NullableString,
    youAreUpIndicator: NullableString,
    countdownClock: NullableString,
    playerRows: NullableString,
    playerNameWithinRow: NullableString,
    playerPositionWithinRow: NullableString,
    playerNflTeamWithinRow: NullableString,
    draftResultRows: NullableString,
    draftResultPickWithinRow: NullableString,
    draftResultTeamWithinRow: NullableString,
    draftResultPlayerWithinRow: NullableString,
    userRosterRows: NullableString,
    playerSearchInput: NullableString,
    draftAction: NullableString,
    draftConfirmation: NullableString
  })
});

export type SelectorConfig = z.infer<typeof SelectorConfigSchema>;

export function loadSelectorConfig(path: string): SelectorConfig {
  return SelectorConfigSchema.parse(JSON.parse(fs.readFileSync(path, "utf8")));
}

export function assertSelectorsConfigured(config: SelectorConfig): void {
  if (config.status.startsWith("UNCONFIGURED")) {
    throw new Error(
      "CBS selectors are not configured. Use Playwright MCP/codegen against the actual logged-in draft room; do not guess selectors."
    );
  }
}
