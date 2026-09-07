import type {
  DraftPickEvent,
  DraftState,
  LeagueConfig,
  Position,
  RosterPlayer,
  SportslinePlayer
} from "../domain/types.js";
import { normalizePlayerName, teamNameKey } from "../data/normalize.js";
import type { LeagueKeeper } from "../data/leagueKeepers.js";
import { teamByName, type RosterGrid } from "../data/rosterGrid.js";
import { resolvePlayer } from "./identity.js";
import { nextOverallPickByTeam } from "./pickOwnership.js";
import { POSITIONS } from "../domain/types.js";

export interface TeamRosterArgs {
  teamName: string;
  players: SportslinePlayer[];
  draftEvents: DraftPickEvent[];
  keepers?: LeagueKeeper[];
  rosterGrid?: RosterGrid;
}

function lastNameKey(name: string, position: Position): string {
  const normalized = normalizePlayerName(name, position).toLowerCase();
  const last = normalized.split(" ").filter(Boolean).pop() ?? normalized;
  return `${last}::${position}`;
}

function resolveRosterPlayer(
  players: SportslinePlayer[],
  name: string,
  position: Position
): Pick<RosterPlayer, "playerId" | "name" | "byeWeek"> {
  const exact = resolvePlayer(players, name, position);
  if (exact.ok) {
    return { playerId: exact.player.id, name: exact.player.name, byeWeek: exact.player.byeWeek };
  }
  const last = lastNameKey(name, position);
  const matches = players.filter((player) => lastNameKey(player.name, player.position) === last);
  if (matches.length === 1) {
    const player = matches[0]!;
    return { playerId: player.id, name: player.name, byeWeek: player.byeWeek };
  }
  return {
    playerId: `${name.toLowerCase()}::${position}`,
    name,
    byeWeek: null
  };
}

export function rosterPlayersForTeam(args: TeamRosterArgs): RosterPlayer[] {
  const key = teamNameKey(args.teamName);
  const out: RosterPlayer[] = [];
  const seen = new Set<string>();

  const add = (name: string, position: Position, source: RosterPlayer["source"]) => {
    const dedupe = lastNameKey(name, position);
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    const resolved = resolveRosterPlayer(args.players, name, position);
    out.push({
      playerId: resolved.playerId,
      name: resolved.name,
      position,
      byeWeek: resolved.byeWeek,
      source
    });
  };

  if (args.rosterGrid) {
    const team = teamByName(args.rosterGrid, args.teamName);
    if (team) {
      for (const position of POSITIONS) {
        for (const entry of team.starters[position] ?? []) {
          add(entry.name, position, "keeper");
        }
      }
    }
  }

  for (const keeper of args.keepers ?? []) {
    if (teamNameKey(keeper.fantasyTeam) !== key) continue;
    add(keeper.playerName, keeper.position, "keeper");
  }

  for (const event of args.draftEvents) {
    if (teamNameKey(event.fantasyTeam) !== key) continue;
    if (!event.position) continue;
    add(event.playerName, event.position, "draft");
  }

  return out;
}

export function draftStateForOnClockTeam(args: {
  state: DraftState;
  teamName: string;
  league: LeagueConfig;
  players: SportslinePlayer[];
  keepers?: LeagueKeeper[];
  rosterGrid?: RosterGrid;
}): DraftState {
  const nextPicks = nextOverallPickByTeam(args.league, args.state.currentOverallPick);
  return {
    ...args.state,
    teamOnClock: args.teamName,
    isUserTurn: true,
    nextUserOverallPick: nextPicks.get(teamNameKey(args.teamName)) ?? null,
    roster: {
      players: rosterPlayersForTeam({
        teamName: args.teamName,
        players: args.players,
        draftEvents: args.state.draftEvents,
        keepers: args.keepers,
        rosterGrid: args.rosterGrid
      })
    }
  };
}
