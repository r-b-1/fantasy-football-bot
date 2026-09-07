import { POSITIONS, type LeagueConfig, type Position, type StrategyConfig } from "../domain/types.js";
import { allTeamNames, teamByName, teamStarterCount, type RosterGrid } from "../data/rosterGrid.js";

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
}): TeamNeed[] {
  const merged = mergeDraftedIntoRoster(args.rosterGrid, args.drafted);
  const teams = allTeamNames(merged).map((name) => {
    const team = teamByName(merged, name)!;
    const gaps: Partial<Record<Position, number>> = {};
    let totalGap = 0;
    for (const position of POSITIONS) {
      const target = expectedStarterTarget(args.league, position);
      const current = teamStarterCount(team, position);
      const gap = Math.max(0, target - current);
      if (gap > 0) gaps[position] = gap;
      totalGap += gap;
    }
    const teamKey = name.toLowerCase();
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
  const team = args.teamNeeds.find((need) => need.teamName.toLowerCase() === args.teamName.toLowerCase());
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
  const teamCount = args.league.teamCount;
  const result = new Map<string, number>();

  const slotByPick = (overallPick: number) => {
    const positionInRound = ((overallPick - 1) % teamCount) + 1;
    const round = Math.ceil(overallPick / teamCount);
    return round % 2 === 1 ? positionInRound : teamCount - positionInRound + 1;
  };

  for (let i = 1; i <= teamCount; i += 1) {
    const userSlots = new Set<number>([args.league.draftSlot]);
    let candidate = args.currentOverallPick + 1;
    let found: number | null = null;
    let safety = teamCount * 4;
    while (safety-- > 0) {
      if (slotByPick(candidate) === i) {
        found = candidate;
        break;
      }
      candidate += 1;
      if (candidate > 320) break;
    }
    if (found != null) {
      if (userSlots.has(i)) {
        result.set(args.userTeamName.toLowerCase(), found);
      } else {
        result.set(`slot-${i}`, found);
      }
    }
  }

  return result;
}

function mergeDraftedIntoRoster(
  roster: RosterGrid,
  drafted: Array<{ fantasyTeam: string; playerName: string; position?: Position }>
): RosterGrid {
  const byTeam = new Map<string, ReturnedGroup>();
  for (const team of roster.teams) {
    byTeam.set(team.teamName.toLowerCase(), {
      teamName: team.teamName,
      starters: structuredClone(team.starters)
    });
  }
  for (const pick of drafted) {
    const key = pick.fantasyTeam.toLowerCase();
    const team = byTeam.get(key);
    if (!team || !pick.position) continue;
    const position = pick.position;
    const existing = team.starters[position] ?? [];
    team.starters = {
      ...team.starters,
      [position]: [...existing, { name: pick.playerName, position, isRookie: false }]
    };
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