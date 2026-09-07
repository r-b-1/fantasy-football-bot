import fs from "node:fs";
import path from "node:path";
import { loadLeagueConfig } from "../config/load.js";
import { normalizePlayerName, playerKey, teamNameKey } from "../data/normalize.js";
import { loadRosterGrid } from "../data/rosterGrid.js";
import { loadSportslineWorkbook } from "../data/sportsline.js";
import type { Position } from "../domain/types.js";
import { buildPickOwnership } from "../engine/pickOwnership.js";

export interface RichFixtureScript {
  keepers: Array<{ name: string; position: Position; fantasyTeam: string; aliases?: string[] }>;
  teams: string[];
  autopickPool: Array<{ name: string; position: Position; _skip?: boolean }>;
  userDraftSlots?: number[];
  pickOwners?: Record<number, string>;
}

// These two initials are ambiguous in the rankings; confirmed by the operator.
const ROSTER_ALIASES: Record<string, string> = {
  "b robinson::RB": "Bijan Robinson",
  "t etienne::RB": "Travis Etienne"
};

export function loadRichFixtureScript(rootDir = process.cwd()): RichFixtureScript {
  const script: RichFixtureScript = JSON.parse(fs.readFileSync(
    path.resolve(rootDir, process.env.RICH_FIXTURE ?? "fixtures/fixture-16team-rich.json"), "utf8"
  ));
  const league = loadLeagueConfig(path.resolve(rootDir, process.env.LEAGUE_CONFIG ?? "config/league.current.json"));
  script.teams = league.draftOrder ?? script.teams;
  script.pickOwners = Object.fromEntries(buildPickOwnership(league));
  if (!league.rosterGridPath) return script;

  const grid = loadRosterGrid(path.resolve(rootDir, league.rosterGridPath));
  const players = loadSportslineWorkbook(path.resolve(
    rootDir, process.env.SPORTSLINE_XLSX ?? "data/reference/cheatsheet_cbsppr12.xlsx"
  ));
  const nameKey = (name: string) => normalizePlayerName(name).toLowerCase().replace(/[.'-]/g, "");
  script.keepers = [];
  for (const team of grid.teams) {
    const fantasyTeam = script.teams.find((name) => teamNameKey(name) === teamNameKey(team.teamName)) ?? team.teamName;
    for (const [position, entries] of Object.entries(team.starters)) {
      for (const entry of entries) {
        const name = ROSTER_ALIASES[playerKey(entry.name, position as Position)] ?? entry.name;
        const key = nameKey(name);
        const exact = players.filter((player) => player.position === position && nameKey(player.name) === key);
        const matches = exact.length ? exact : players.filter((player) => {
          const candidate = nameKey(player.name);
          return player.position === position && candidate[0] === key[0] &&
            candidate.slice(candidate.indexOf(" ")) === key.slice(key.indexOf(" "));
        });
        if (matches.length !== 1) {
          throw new Error(`Cannot uniquely resolve keeper "${entry.name}" (${position}) for ${team.teamName}`);
        }
        script.keepers.push({
          name: matches[0]!.name,
          position: matches[0]!.position,
          fantasyTeam,
          aliases: [entry.name]
        });
      }
    }
  }

  // Keep the curated opening order, then use the rankings for the remaining rounds.
  const poolIds = new Set(script.autopickPool.map((player) => playerKey(player.name, player.position)));
  for (const player of [...players].sort((a, b) => (a.adp ?? Infinity) - (b.adp ?? Infinity))) {
    if (!poolIds.has(player.id)) {
      script.autopickPool.push({ name: player.name, position: player.position });
      poolIds.add(player.id);
    }
  }
  const keeperIds = new Set(script.keepers.map((keeper) => playerKey(keeper.name, keeper.position)));
  script.autopickPool = script.autopickPool.map((player) => ({
    ...player,
    _skip: keeperIds.has(playerKey(player.name, player.position))
  }));
  return script;
}
