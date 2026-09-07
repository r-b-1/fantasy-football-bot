import {
  loadLeagueConfig,
  loadStrategyConfig
} from "../config/load.js";
import { loadSportslineWorkbook } from "../data/sportsline.js";
import { loadRosterGrid } from "../data/rosterGrid.js";
import { resolveProjectionKeepers } from "../data/leagueKeepers.js";
import {
  compareFantasyProsRankings,
  importFantasyProsRankingsCsv,
  type FantasyProsRanking
} from "../data/fantasyProsRankings.js";
import { nextUserOverallPick, snakeDraftSlot, snakeOverallPicks, estimatedDraftRounds, toLivePlayers } from "../engine/state.js";
import {
  canonicalizeDraftOrder,
  formatPickInterval,
  ownerFromDraftOrder
} from "../cbs/roomFacts.js";
import { formatClockDuration } from "../cbs/parse.js";
import { playerKey, teamNameKey, normalizePlayerName } from "../data/normalize.js";
import type {
  DraftPickEvent,
  DraftState,
  LeagueConfig,
  LivePlayer,
  Position,
  SportslinePlayer,
  StrategyConfig
} from "../domain/types.js";
import {
  applyKeeperExclusions,
  type CompanionKeeper,
  type CompanionPick,
  type RoomOverlay,
  type RoomPublicStatus
} from "./roomSync.js";

export interface SessionState {
  league: LeagueConfig;
  strategy: StrategyConfig;
  slPool: LivePlayer[];
  fpPool: LivePlayer[];
  fpRankById: Map<string, number>;
  slById: Map<string, SportslinePlayer>;
  teamIndex: Map<string, string>;
  allKeepers: CompanionKeeper[];
  draftedPicks: CompanionPick[];
  draftEvents: DraftPickEvent[];
  source: "sportsline" | "fantasypros";
  room: RoomOverlay | null;
}

// Same operator-confirmed ambiguous initials used by the rich fixture loader.
const ROSTER_ALIASES: Record<string, string> = {
  "b robinson::RB": "Bijan Robinson",
  "t etienne::RB": "Travis Etienne"
};

function applyFPRatings(sl: SportslinePlayer[], fp: FantasyProsRanking[]): SportslinePlayer[] {
  const lookup = new Map<string, number>();
  for (const ranking of fp) lookup.set(playerKey(ranking.name, ranking.position), ranking.ecrRank);
  const max = Math.max(...fp.map((ranking) => ranking.ecrRank));
  return sl.map((player) => {
    const ecr = lookup.get(player.id);
    if (ecr == null) return { ...player, sportslineRating: 0 };
    const rating = Math.round((1 - (ecr - 1) / Math.max(1, max - 1)) * 100);
    return { ...player, sportslineRating: rating };
  });
}

function resolveRosterName(name: string, position: Position, slPlayers: SportslinePlayer[]): SportslinePlayer {
  const nameKey = (value: string) => normalizePlayerName(value).toLowerCase().replace(/[.'-]/g, "");
  const key = nameKey(ROSTER_ALIASES[playerKey(name, position)] ?? name);
  const exact = slPlayers.filter((player) => player.position === position && nameKey(player.name) === key);
  const matches = exact.length
    ? exact
    : slPlayers.filter((player) => {
        const candidate = nameKey(player.name);
        return (
          player.position === position &&
          candidate[0] === key[0] &&
          candidate.slice(candidate.indexOf(" ")) === key.slice(key.indexOf(" "))
        );
      });
  if (matches.length !== 1) {
    throw new Error(`Cannot uniquely resolve keeper "${name}" (${position})`);
  }
  return matches[0]!;
}

export function pickOwnerAt(league: LeagueConfig, overallPick: number, teamIndex: Map<string, string>): string {
  for (const assignment of league.leaguePicks ?? []) {
    if (assignment.picks.includes(overallPick)) {
      return teamIndex.get(teamNameKey(assignment.teamName)) ?? assignment.teamName;
    }
  }
  const slot = snakeDraftSlot(overallPick, league.teamCount);
  const order = league.draftOrder;
  if (!order || order.length !== league.teamCount) {
    throw new Error(`No draftOrder for pick ${overallPick}`);
  }
  const canonical = order[slot - 1]!;
  return teamIndex.get(teamNameKey(canonical)) ?? canonical;
}

export function pickOwnerForSession(
  session: SessionState,
  overallPick: number,
  roomOrder?: string[]
): string | null {
  if (roomOrder !== undefined) {
    if (roomOrder.length === 0) return null;
    const fromRoom = ownerFromDraftOrder(roomOrder, overallPick, session.league.teamCount);
    return fromRoom ? session.teamIndex.get(teamNameKey(fromRoom)) ?? fromRoom : null;
  }
  return pickOwnerAt(session.league, overallPick, session.teamIndex);
}

export function buildSession(): SessionState {
  const league = loadLeagueConfig(process.env.LEAGUE_CONFIG ?? "config/league.current.json");
  const strategy = loadStrategyConfig(process.env.STRATEGY_CONFIG ?? "config/strategy.current.json");
  const slPlayers = loadSportslineWorkbook(process.env.SPORTSLINE_XLSX ?? "data/reference/cheatsheet_cbsppr12.xlsx");
  const fp = importFantasyProsRankingsCsv(
    process.env.FANTASY_PROS_RANKINGS_CSV ?? "FantasyPros_2026_Draft_ALL_Rankings.csv"
  );

  const teamIndex = new Map<string, string>();
  for (const canonical of league.draftOrder ?? []) teamIndex.set(teamNameKey(canonical), canonical);
  for (const assignment of league.leaguePicks ?? []) teamIndex.set(teamNameKey(assignment.teamName), assignment.teamName);

  const allKeepers: CompanionKeeper[] = [];
  const keeperOwners = new Map<string, string>();
  const rosterGridPath = process.env.COMPANION_ROSTERGRID_CSV ?? league.rosterGridPath;
  const addKeeper = (fantasyTeam: string, name: string, position: Position): void => {
    const canonical = teamIndex.get(teamNameKey(fantasyTeam));
    if (!canonical) throw new Error(`Unknown keeper team "${fantasyTeam}"`);
    const player = resolveRosterName(name, position, slPlayers);
    const owner = keeperOwners.get(player.id);
    if (owner) {
      if (rosterGridPath || owner !== canonical) {
        throw new Error(`Duplicate keeper "${player.name}" for ${owner} and ${canonical}`);
      }
      return;
    }
    keeperOwners.set(player.id, canonical);
    allKeepers.push({ fantasyTeam: canonical, name: player.name, position: player.position });
  };

  // A configured grid is exclusive: neither JSON/config keepers nor trades override it.
  if (rosterGridPath) {
    const grid = loadRosterGrid(rosterGridPath);
    const seenTeams = new Set<string>();
    for (const team of grid.teams) {
      const canonical = teamIndex.get(teamNameKey(team.teamName));
      if (!canonical) throw new Error(`Unknown keeper team "${team.teamName}"`);
      if (seenTeams.has(canonical)) throw new Error(`Duplicate keeper team "${canonical}"`);
      seenTeams.add(canonical);
      const before = allKeepers.length;
      for (const [position, entries] of Object.entries(team.starters)) {
        for (const entry of entries) {
          addKeeper(canonical, entry.name, position as Position);
        }
      }
      if (allKeepers.length - before !== league.keeperSlots) {
        throw new Error(`Expected ${league.keeperSlots} keepers for ${canonical}`);
      }
    }
    if (seenTeams.size !== league.teamCount) {
      throw new Error(`Expected ${league.teamCount} keeper teams, got ${seenTeams.size}`);
    }
  } else {
    for (const keeper of resolveProjectionKeepers(league)) {
      addKeeper(keeper.fantasyTeam, keeper.playerName, keeper.position);
    }
  }

  const comparison = compareFantasyProsRankings(fp.players, slPlayers);
  const fpRankById = new Map(comparison.matches.map((row) => [row.sportsline!.id, row.fantasyPros.ecrRank]));
  const slPool = toLivePlayers(slPlayers, new Set());
  for (const player of slPool) player.available = true;
  const fpPool = toLivePlayers(applyFPRatings(slPlayers, fp.players), new Set());
  for (const player of fpPool) player.available = true;
  const slById = new Map<string, SportslinePlayer>(slPlayers.map((player) => [player.id, player]));

  const session: SessionState = {
    league,
    strategy,
    slPool,
    fpPool,
    fpRankById,
    slById,
    teamIndex,
    allKeepers,
    draftedPicks: [],
    draftEvents: [],
    source: "fantasypros",
    room: null
  };
  applyKeeperExclusions(session);
  return session;
}

export function currentLivePool(session: SessionState): LivePlayer[] {
  return session.source === "sportsline" ? session.slPool : session.fpPool;
}

export function buildDraftState(session: SessionState): DraftState {
  const overlay = session.room;
  const waitingToStart = overlay?.waitingToStart ?? false;
  const overallPick = overlay?.currentOverallPick ?? (waitingToStart ? 1 : session.draftedPicks.length + 1);
  const livePlayers = currentLivePool(session);
  const roomOrder = overlay?.draftOrder?.length ? overlay.draftOrder : undefined;
  const computedTeam = pickOwnerForSession(session, overallPick, roomOrder) ?? pickOwnerAt(session.league, overallPick, session.teamIndex);
  const teamOnClock = overlay?.teamOnClock?.trim() ? overlay.teamOnClock : computedTeam;
  const isUserTurn = overlay ? overlay.isUserTurn : teamOnClock === session.league.userTeamName;
  const userRoster: { name: string; position: Position; source: "keeper" | "draft" }[] = [];
  for (const keeper of session.allKeepers) {
    if (teamNameKey(keeper.fantasyTeam) === teamNameKey(session.league.userTeamName)) {
      userRoster.push({ name: keeper.name, position: keeper.position, source: "keeper" });
    }
  }
  for (const event of session.draftEvents) {
    if (teamNameKey(event.fantasyTeam) === teamNameKey(session.league.userTeamName)) {
      userRoster.push({ name: event.playerName, position: event.position ?? "WR", source: "draft" });
    }
  }
  const recent = session.draftEvents.slice(-session.strategy.recentPickWindow);
  const recentPositionCounts: Partial<Record<Position, number>> = {};
  for (const event of recent) {
    if (event.position) recentPositionCounts[event.position] = (recentPositionCounts[event.position] ?? 0) + 1;
  }
  return {
    currentOverallPick: overallPick,
    nextUserOverallPick: nextUserOverallPick(overallPick, session.league.knownOverallPicks),
    teamOnClock,
    isUserTurn,
    clockSecondsRemaining: overlay?.clockSecondsRemaining ?? null,
    snapshotAt: overlay?.capturedAt ?? new Date().toISOString(),
    roster: {
      players: userRoster.map((player) => {
        const live = livePlayers.find((candidate) => candidate.name === player.name && candidate.position === player.position);
        return {
          playerId: live?.id ?? `unknown::${player.position}`,
          name: player.name,
          position: player.position,
          byeWeek: live?.byeWeek ?? null,
          source: player.source
        };
      })
    },
    draftEvents: session.draftEvents,
    availablePlayerIds: new Set(livePlayers.filter((player) => player.available).map((player) => player.id)),
    recentPositionCounts,
    warnings: overlay?.conflicts ?? []
  };
}

export function serializeCompanionState(session: SessionState, room: RoomPublicStatus) {
  const livePlayers = currentLivePool(session);
  const state = buildDraftState(session);
  const overlay = session.room;
  const waitingToStart = overlay?.waitingToStart ?? false;
  const roomOrder = overlay?.draftOrder?.length
    ? canonicalizeDraftOrder(overlay.draftOrder, session.teamIndex)
    : [];
  const watchingRoom = room.status === "watching" || room.status === "awaiting_draft_room";
  const draftOrder = watchingRoom ? roomOrder : (session.league.draftOrder ?? []);
  const draftOrderSource = watchingRoom ? (roomOrder.length > 0 ? "cbs" : null) : "config";
  const upcomingStart = state.currentOverallPick;
  const upcomingPicks = Array.from({ length: 6 }, (_, index) => {
    const overallPick = upcomingStart + index;
    const fantasyTeam = pickOwnerForSession(session, overallPick, watchingRoom ? roomOrder : undefined);
    return fantasyTeam ? { overallPick, fantasyTeam } : null;
  }).filter((pick): pick is { overallPick: number; fantasyTeam: string } => pick != null);
  const userSlot = draftOrder.findIndex((name) => teamNameKey(name) === teamNameKey(session.league.userTeamName)) + 1;
  const cbsUserPicks =
    draftOrderSource === "cbs" && userSlot > 0
      ? snakeOverallPicks(userSlot, session.league.teamCount, estimatedDraftRounds(session.league))
      : session.league.knownOverallPicks;
  const nextUser =
    draftOrderSource === "cbs"
      ? nextUserOverallPick(state.currentOverallPick, [...new Set([...cbsUserPicks, ...session.league.knownOverallPicks])])
      : state.nextUserOverallPick;
  return {
    source: session.source,
    leagueName: session.league.leagueName,
    userTeamName: session.league.userTeamName,
    teamCount: session.league.teamCount,
    lineup: session.league.lineup,
    keepers: session.allKeepers,
    knownOverallPicks: session.league.knownOverallPicks,
    round: Math.ceil(state.currentOverallPick / session.league.teamCount),
    draftOrder,
    draftOrderSource,
    upcomingPicks,
    currentOverallPick: state.currentOverallPick,
    waitingToStart,
    teamOnClock: state.teamOnClock,
    isUserTurn: state.isUserTurn,
    nextUserOverallPick: nextUser,
    clockSecondsRemaining: state.clockSecondsRemaining,
    clockRaw: overlay?.clockRaw ?? null,
    clockLabel: formatClockDuration(state.clockSecondsRemaining),
    secondsPerPick: overlay?.secondsPerPick ?? null,
    pickClockRaw: overlay?.pickClockRaw ?? null,
    pickIntervalLabel: formatPickInterval(overlay?.secondsPerPick ?? null, overlay?.pickClockRaw),
    userRoster: state.roster.players.map((player) => ({
      name: player.name,
      position: player.position,
      source: player.source
    })),
    draftedCount: session.draftedPicks.length,
    picks: session.draftedPicks.map((pick) => ({
      overallPick: pick.overallPick,
      fantasyTeam: pick.fantasyTeam,
      playerId: pick.playerId,
      playerName: pick.playerName,
      position: pick.position
    })),
    availablePlayers: livePlayers
      .filter((player) => player.available)
      .map((player) => ({
        id: player.id,
        name: player.name,
        position: player.position,
        adp: player.adp,
        rating: player.sportslineRating,
        sportslineRating: session.slById.get(player.id)!.sportslineRating,
        fantasyProsRank: session.fpRankById.get(player.id) ?? null
      })),
    room
  };
}
