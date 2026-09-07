import fs from "node:fs";
import { z } from "zod";
import { EngineError } from "../domain/errors.js";
import { POSITIONS, type Position } from "../domain/types.js";
import type { LeagueConfig } from "../domain/types.js";
import { teamNameKey } from "./normalize.js";

export interface LeagueKeeper {
  fantasyTeam: string;
  playerName: string;
  position: Position;
}

const PositionSchema = z.enum(POSITIONS);

const JsonKeeperSchema = z.object({
  fantasyTeam: z.string().min(1),
  name: z.string().min(1).optional(),
  playerName: z.string().min(1).optional(),
  position: PositionSchema
});

const JsonKeepersFileSchema = z.union([
  z.array(JsonKeeperSchema),
  z.object({ keepers: z.array(JsonKeeperSchema) })
]);

function toLeagueKeeper(raw: z.infer<typeof JsonKeeperSchema>): LeagueKeeper {
  const playerName = raw.playerName ?? raw.name;
  if (!playerName) {
    throw new EngineError("invalid_config", "Keeper is missing name/playerName");
  }
  return { fantasyTeam: raw.fantasyTeam, playerName, position: raw.position };
}

function parseCsvKeepers(text: string): LeagueKeeper[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return [];
  const header = lines[0]!.split(",").map((col) => col.trim().toLowerCase());
  const teamIdx = header.findIndex((col) => col === "fantasyteam" || col === "team" || col === "fantasy_team");
  const nameIdx = header.findIndex((col) => col === "name" || col === "player" || col === "playername" || col === "player_name");
  const posIdx = header.findIndex((col) => col === "position" || col === "pos");
  if (teamIdx < 0 || nameIdx < 0 || posIdx < 0) {
    throw new EngineError(
      "invalid_config",
      "Keepers CSV must include fantasyTeam, name, and position columns"
    );
  }
  const keepers: LeagueKeeper[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((cell) => cell.trim());
    const fantasyTeam = cells[teamIdx] ?? "";
    const playerName = cells[nameIdx] ?? "";
    const positionRaw = cells[posIdx] ?? "";
    if (!fantasyTeam || !playerName || !positionRaw) continue;
    if (!(POSITIONS as readonly string[]).includes(positionRaw)) {
      throw new EngineError("invalid_config", `Unknown keeper position "${positionRaw}"`);
    }
    keepers.push({
      fantasyTeam,
      playerName,
      position: positionRaw as Position
    });
  }
  return keepers;
}

export function loadLeagueKeepers(filePath: string): LeagueKeeper[] {
  if (!fs.existsSync(filePath)) {
    throw new EngineError("invalid_config", `League keepers file not found at ${filePath}`, {
      path: filePath
    });
  }
  const text = fs.readFileSync(filePath, "utf8");
  if (filePath.toLowerCase().endsWith(".csv")) {
    return parseCsvKeepers(text);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new EngineError("invalid_config", `League keepers JSON is invalid at ${filePath}`, {
      path: filePath
    });
  }
  const result = JsonKeepersFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new EngineError(
      "invalid_config",
      `Invalid league keepers at ${filePath}: ${result.error.message}`,
      { path: filePath, issues: result.error.issues }
    );
  }
  const rows = Array.isArray(result.data) ? result.data : result.data.keepers;
  return rows.map(toLeagueKeeper);
}

function keeperKey(keeper: LeagueKeeper): string {
  return `${teamNameKey(keeper.fantasyTeam)}::${keeper.playerName.toLowerCase()}::${keeper.position}`;
}

export function resolveProjectionKeepers(league: LeagueConfig): LeagueKeeper[] {
  const merged = new Map<string, LeagueKeeper>();
  if (league.leagueKeepersPath) {
    for (const keeper of loadLeagueKeepers(league.leagueKeepersPath)) {
      merged.set(keeperKey(keeper), keeper);
    }
  }
  for (const keeper of league.keepers) {
    const row: LeagueKeeper = {
      fantasyTeam: league.userTeamName,
      playerName: keeper.name,
      position: keeper.position
    };
    merged.set(keeperKey(row), row);
  }
  return [...merged.values()];
}
