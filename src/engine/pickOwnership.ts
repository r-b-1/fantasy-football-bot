import type { LeagueConfig } from "../domain/types.js";
import { teamNameKey } from "../data/normalize.js";
import { estimatedDraftRounds, snakeOverallPicks } from "./state.js";

export function buildPickOwnership(league: LeagueConfig): Map<number, string> {
  const rounds = estimatedDraftRounds(league);
  const draftOrder = league.draftOrder ?? [];
  const map = new Map<number, string>();

  for (let slot = 1; slot <= league.teamCount; slot += 1) {
    const teamName =
      draftOrder[slot - 1] ??
      (slot === league.draftSlot ? league.userTeamName : `slot-${slot}`);
    for (const pick of snakeOverallPicks(slot, league.teamCount, rounds)) {
      map.set(pick, teamName);
    }
  }

  for (const entry of league.leaguePicks) {
    assignTeamPicks(map, entry.teamName, entry.picks, {
      partial: league.leaguePicksArePartial,
      snakePicks: snakePicksForTeam(league, entry.teamName, draftOrder, rounds)
    });
  }

  assignTeamPicks(map, league.userTeamName, league.knownOverallPicks, {
    partial: league.knownPicksArePartial,
    snakePicks: snakeOverallPicks(league.draftSlot, league.teamCount, rounds)
  });

  return map;
}

export function ownerOfPick(league: LeagueConfig, overallPick: number): string | undefined {
  return buildPickOwnership(league).get(overallPick);
}

export function nextOverallPickByTeam(
  league: LeagueConfig,
  currentOverallPick: number
): Map<string, number> {
  const ownership = buildPickOwnership(league);
  const result = new Map<string, number>();
  const owned = [...ownership.keys()];
  const maxPick = Math.max(currentOverallPick + league.teamCount * 4, ...owned, 0);
  for (let pick = currentOverallPick + 1; pick <= maxPick; pick += 1) {
    const team = ownership.get(pick);
    if (!team) continue;
    const key = teamNameKey(team);
    if (!result.has(key)) result.set(key, pick);
  }
  return result;
}

function snakePicksForTeam(
  league: LeagueConfig,
  teamName: string,
  draftOrder: string[],
  rounds: number
): number[] {
  if (teamNameKey(teamName) === teamNameKey(league.userTeamName)) {
    return snakeOverallPicks(league.draftSlot, league.teamCount, rounds);
  }
  const index = draftOrder.findIndex((name) => teamNameKey(name) === teamNameKey(teamName));
  if (index < 0) return [];
  return snakeOverallPicks(index + 1, league.teamCount, rounds);
}

function assignTeamPicks(
  map: Map<number, string>,
  teamName: string,
  picks: number[],
  options: { partial: boolean; snakePicks: number[] }
): void {
  const key = teamNameKey(teamName);
  for (const pick of picks) {
    map.set(pick, teamName);
  }
  if (picks.length === 0) return;

  if (!options.partial) {
    for (const [pick, owner] of [...map.entries()]) {
      if (teamNameKey(owner) === key && !picks.includes(pick)) {
        map.delete(pick);
      }
    }
    return;
  }

  const knownMax = Math.max(...picks);
  for (const snakePick of options.snakePicks) {
    if (snakePick <= knownMax && !picks.includes(snakePick)) {
      const owner = map.get(snakePick);
      if (owner && teamNameKey(owner) === key) {
        map.delete(snakePick);
      }
    }
  }
}
