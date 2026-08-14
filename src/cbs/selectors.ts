import fs from "node:fs";
import { z } from "zod";

const NullableString = z.string().nullable();
const SelectorConfigSchema = z.object({
  kind: z.enum(["live", "fixture"]).default("live"),
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

export function resolveSelectorConfigPath(): string {
  if (process.env.SELECTOR_CONFIG) return process.env.SELECTOR_CONFIG;
  if (fs.existsSync("config/selectors.local.json")) return "config/selectors.local.json";
  if (fs.existsSync("config/selectors.live.json")) return "config/selectors.live.json";
  return "config/selectors.example.json";
}

export function assertSelectorsConfigured(config: SelectorConfig): void {
  if (config.kind === "fixture") return;
  if (config.status.startsWith("UNCONFIGURED")) {
    throw new Error(
      "CBS selectors are not configured. Use Playwright MCP/codegen against the actual logged-in draft room; do not guess selectors."
    );
  }
}

export function assertLiveSelectorConfig(config: SelectorConfig): void {
  if (config.kind === "fixture") {
    throw new Error("Fixture selectors cannot be used against live CBS.");
  }
  assertSelectorsConfigured(config);
}

export function assertFixtureSelectorConfig(config: SelectorConfig): void {
  if (config.kind !== "fixture") {
    throw new Error("Local fake draft room requires config kind=fixture.");
  }
}

export function requiredReadSelectors(config: SelectorConfig): string[] {
  const required: Array<keyof SelectorConfig["selectors"]> = [
    "currentPick",
    "teamOnClock",
    "youAreUpIndicator",
    "draftResultRows",
    "draftResultPickWithinRow",
    "draftResultTeamWithinRow",
    "draftResultPlayerWithinRow"
  ];
  return required.filter((field) => !config.selectors[field]);
}

export function allSelectorFields(config: SelectorConfig): Array<[string, string | null]> {
  return Object.entries(config.selectors);
}
