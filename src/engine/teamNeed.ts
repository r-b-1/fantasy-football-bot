import { POSITIONS, type LeagueConfig, type Position } from "../domain/types.js";
import { teamNameKey } from "../data/normalize.js";
import { allTeamNames, teamStarterCount, type RosterGrid } from "../data/rosterGrid.js";
import { nextOverallPickByTeam } from "./pickOwnership.js";

export { ownerOfPick } from "./pickOwnership.js";

export interface TeamNeed {
  teamName: string;
  nextOverallPick: number | null;
  startingNeed: Partial<Record<Position, number>>;
  totalGap: number;
}

export interface NeedScore {
  team: string;
  pick: number | null;
  position: Position;
  score: number;
  weight: number;
}

const POSITION_WEIGHTS: Record<Position, number> = {
  QB: 1.0,
  RB: 1.4,
  WR: 1.3,
  TE: 1.1,
  K: 0.6,
  DST: 0.6
};

function expectedStarterTarget(league: LeagueConfig, position: Position): number {
  return league.lineup[position] ?? 0;
}

export function computeTeamNeeds(args: {
  rosterGrid: RosterGrid;
  drafted: Array<{ fantasyTeam: string; playerName: string; position?: Position }>;
  nextPicksByTeam: Map<string, number>;
  league: LeagueConfig;
  keepers?: Array<{ fantasyTeam: string; playerName: string; position: Position }>;
}): TeamNeed[] {
  const merged = mergeDraftedAndKeepers(args.rosterGrid, args.drafted, args.keepers ?? []);
  const teams = allTeamNames(merged).map((name) => {
    const team = byTeam(merged, name)!;
    const gaps: Partial<Record<Position, number>> = {};
    let totalGap = 0;
    for (const position of POSITIONS) {
      const target = expectedStarterTarget(args.league, position);
      const current = teamStarterCount(team, position);
      const gap = Math.max(0, target - current);
      if (gap > 0) gaps[position] = gap;
      totalGap += gap;
    }
    const teamKey = teamNameKey(name);
    return {
      teamName: name,
      nextOverallPick: args.nextPicksByTeam.get(teamKey) ?? null,
      startingNeed: gaps,
      totalGap
    };
  });
  return teams;
}

export function scoreProjectedPickForTeam(args: {
  teamName: string;
  position: Position;
  teamNeeds: TeamNeed[];
}): number {
  const team = args.teamNeeds.find((need) => teamNameKey(need.teamName) === teamNameKey(args.teamName));
  if (!team) return 0;
  const positionGap = team.startingNeed[args.position] ?? 0;
  if (positionGap <= 0) return 0;
  return positionGap * POSITION_WEIGHTS[args.position] * (1 + Math.min(1, team.totalGap / 6));
}

export function weightedNextPickByTeam(args: {
  league: LeagueConfig;
  currentOverallPick: number;
  userTeamName: string;
  knownUserOverallPicks: number[];
}): Map<string, number> {
  return nextOverallPickByTeam(args.league, args.currentOverallPick);
}

function byTeam(roster: RosterGrid, name: string): ReturnedGroup | undefined {
  return roster.teams.find((team) => teamNameKey(team.teamName) === teamNameKey(name)) as
    | ReturnedGroup
    | undefined;
}

function mergeDraftedAndKeepers(
  roster: RosterGrid,
  drafted: Array<{ fantasyTeam: string; playerName: string; position?: Position }>,
  keepers: Array<{ fantasyTeam: string; playerName: string; position: Position }>
): RosterGrid {
  const byTeam = new Map<string, ReturnedGroup>();
  for (const team of roster.teams) {
    byTeam.set(teamNameKey(team.teamName), {
      teamName: team.teamName,
      starters: structuredClone(team.starters)
    });
  }
  const apply = (
    fantasyTeam: string,
    playerName: string,
    position: Position,
    isRookie: boolean
  ) => {
    const key = teamNameKey(fantasyTeam);
    const team = byTeam.get(key);
    if (!team) return;
    const existing = team.starters[position] ?? [];
    if (existing.some((e) => e.name.toLowerCase() === playerName.toLowerCase())) return;
    team.starters = {
      ...team.starters,
      [position]: [...existing, { name: playerName, position, isRookie }]
    };
  };
  for (const pick of drafted) {
    if (!pick.position) continue;
    apply(pick.fantasyTeam, pick.playerName, pick.position, false);
  }
  for (const keeper of keepers) {
    apply(keeper.fantasyTeam, keeper.playerName, keeper.position, false);
  }
  return {
    ...roster,
    teams: Array.from(byTeam.values())
  };
}

type ReturnedGroup = {
  teamName: string;
  starters: Partial<Record<Position, { name: string; position: Position; isRookie: boolean }[]>>;
};