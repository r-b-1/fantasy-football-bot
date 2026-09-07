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
  if (!fs.existsSync(path)) {
    throw new Error(
      `CBS selector config not found at ${path}. Use config/selectors.live.json, or copy it to config/selectors.local.json after diagnose.`
    );
  }
  return SelectorConfigSchema.parse(JSON.parse(fs.readFileSync(path, "utf8")));
}

const DEFAULT_SELECTOR_PATHS = [
  "config/selectors.local.json",
  "config/selectors.live.json",
  "config/selectors.example.json"
];

export function resolveSelectorConfigPath(): string {
  const candidates = [process.env.SELECTOR_CONFIG, ...DEFAULT_SELECTOR_PATHS].filter(
    (path): path is string => Boolean(path && path.trim())
  );
  for (const path of candidates) {
    if (fs.existsSync(path)) return path;
  }
  throw new Error(
    "No CBS selector config found. Expected config/selectors.live.json in the repo."
  );
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

export const REQUIRED_READ_SELECTOR_FIELDS = [
  "currentPick",
  "teamOnClock",
  "youAreUpIndicator",
  "draftResultRows",
  "draftResultPickWithinRow",
  "draftResultTeamWithinRow",
  "draftResultPlayerWithinRow"
] as const satisfies ReadonlyArray<keyof SelectorConfig["selectors"]>;

export function requiredReadSelectors(config: SelectorConfig): string[] {
  return REQUIRED_READ_SELECTOR_FIELDS.filter((field) => !config.selectors[field]);
}

export function allSelectorFields(config: SelectorConfig): Array<[string, string | null]> {
  return Object.entries(config.selectors);
}
