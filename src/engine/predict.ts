import type {
  DraftState,
  LeagueConfig,
  LivePlayer,
  NextPicksProjection,
  Position,
  ProjectedPick,
  StrategyConfig
} from "../domain/types.js";
import type { RosterGrid } from "../data/rosterGrid.js";
import { teamNameKey } from "../data/normalize.js";
import { computeTeamNeeds, scoreProjectedPickForTeam } from "./teamNeed.js";
import { buildPickOwnership } from "./pickOwnership.js";

export interface DeterministicProjectionOptions {
  horizon?: number;
  rosterGrid?: RosterGrid;
  keepers?: Array<{ fantasyTeam: string; playerName: string; position: Position }>;
}

const POSITION_LIMITS: Record<Position, number> = {
  QB: 1,
  RB: 2,
  WR: 3,
  TE: 1,
  K: 1,
  DST: 1
};

export function deterministicProjection(
  players: LivePlayer[],
  state: DraftState,
  league: LeagueConfig,
  strategy: StrategyConfig,
  options: DeterministicProjectionOptions = {}
): NextPicksProjection {
  const horizon = options.horizon ?? 6;
  const rosterGrid = options.rosterGrid;

  if (rosterGrid) {
    return needAwareProjection(players, state, league, strategy, options, rosterGrid, horizon);
  }

  const available = players
    .filter((player) => player.available && state.availablePlayerIds.has(player.id))
    .filter((player) => player.adp != null)
    .sort((a, b) => (a.adp ?? Infinity) - (b.adp ?? Infinity));

  const projectedPicks: ProjectedPick[] = [];
  const pickCursor = state.currentOverallPick;
  const notes: string[] = [];

  let consecutiveNullAdp = 0;
  for (const player of available) {
    if (projectedPicks.length >= horizon) break;
    const adp = player.adp;
    if (adp == null) {
      consecutiveNullAdp += 1;
      if (consecutiveNullAdp > horizon) {
        notes.push("Stopped projecting: too many remaining players have no ADP.");
        break;
      }
      continue;
    }
    consecutiveNullAdp = 0;
    const gap = adp - pickCursor;
    const withinReach = gap <= horizon * 2;
    const expectedOverallPick = withinReach ? adp : pickCursor + horizon;
    projectedPicks.push({
      playerId: player.id,
      playerName: player.name,
      position: player.position,
      expectedOverallPick: Math.round(expectedOverallPick),
      confidence: clampConfidence(0.55 + Math.max(0, 1 - Math.abs(gap) / (horizon * 2)) * 0.25),
      source: "deterministic"
    });
  }

  if (available.length === 0) {
    notes.push("No remaining players with ADP. Projection is empty.");
  } else if (projectedPicks.length === 0) {
    notes.push("All remaining players project past the horizon.");
  }

  return {
    generatedAt: new Date().toISOString(),
    currentOverallPick: pickCursor,
    horizon,
    projectedPicks,
    notes
  };
}

function needAwareProjection(
  players: LivePlayer[],
  state: DraftState,
  league: LeagueConfig,
  _strategy: StrategyConfig,
  options: DeterministicProjectionOptions,
  rosterGrid: RosterGrid,
  horizon: number
): NextPicksProjection {
  const teamNeeds = computeTeamNeeds({
    rosterGrid,
    drafted: state.draftEvents.map((event) => ({
      fantasyTeam: event.fantasyTeam,
      playerName: event.playerName,
      position: event.position
    })),
    nextPicksByTeam: new Map(),
    league,
    keepers: options.keepers
  });

  const teamByPick = buildPickOwnership(league);
  const available = new Map<string, LivePlayer>();
  for (const player of players) {
    if (player.available && state.availablePlayerIds.has(player.id) && player.adp != null) {
      available.set(player.id, player);
    }
  }

  const teamCounts = new Map<string, Partial<Record<Position, number>>>();
  for (const need of teamNeeds) {
    teamCounts.set(teamNameKey(need.teamName), { ...need.startingNeed });
  }
  const projected: ProjectedPick[] = [];
  const notes: string[] = [];
  const usedPlayerIds = new Set<string>();

  for (let pick = state.currentOverallPick + 1; pick <= state.currentOverallPick + horizon * 2; pick += 1) {
    if (projected.length >= horizon) break;
    const teamName = teamByPick.get(pick);
    if (!teamName) {
      notes.push(`No owner configured for pick ${pick} (add leaguePicks or draftOrder).`);
      continue;
    }
    const counts = teamCounts.get(teamNameKey(teamName)) ?? {};
    const isEarlyRound = pick < 130;
    const candidates: Array<{ player: LivePlayer; score: number; need: number }> = [];
    for (const player of available.values()) {
      if (usedPlayerIds.has(player.id)) continue;
      const need = counts[player.position] ?? 0;
      if (need <= 0) continue;
      const target = POSITION_LIMITS[player.position] ?? 1;
      const projectedPosition = need;
      if (projectedPosition <= 0) continue;
      const earlyPenalty = isEarlyRound && (player.position === "K" || player.position === "DST") ? 0.1 : 1;
      const needScore = scoreProjectedPickForTeam({
        teamName,
        position: player.position,
        teamNeeds
      });
      const adp = player.adp ?? pick;
      const adpProximity = clampConfidence(1 - Math.abs(adp - pick) / (horizon * 2)) * 0.4;
      const rating = clampConfidence((player.sportslineRating ?? 50) / 100) * 0.3;
      const fillGapBoost = 1 + Math.min(1, need / Math.max(1, target));
      const score = (needScore + adpProximity + rating) * fillGapBoost * earlyPenalty;
      candidates.push({ player, score, need });
    }
    if (candidates.length === 0) {
      notes.push(`No remaining starter need for ${teamName} at pick ${pick}.`);
      break;
    }
    candidates.sort((a, b) => b.score - a.score);
    const chosen = candidates[0]!;
    usedPlayerIds.add(chosen.player.id);
    const countsForTeam = teamCounts.get(teamNameKey(teamName)) ?? {};
    const current = countsForTeam[chosen.player.position] ?? 0;
    countsForTeam[chosen.player.position] = Math.max(0, current - 1);
    teamCounts.set(teamNameKey(teamName), countsForTeam);
    projected.push({
      playerId: chosen.player.id,
      playerName: chosen.player.name,
      position: chosen.player.position,
      expectedOverallPick: pick,
      confidence: clampConfidence(0.5 + chosen.score / 4),
      source: "deterministic"
    });
  }

  if (projected.length === 0) {
    notes.push("Need-aware projection found no candidates (every team has all starters).");
  } else {
    notes.push("Need-aware projection: ranked by per-team starter gap × ADP proximity × rating.");
  }

  return {
    generatedAt: new Date().toISOString(),
    currentOverallPick: state.currentOverallPick,
    horizon,
    projectedPicks: projected,
    notes
  };
}

function clampConfidence(value: number): number {
  if (Number.isNaN(value)) return 0.5;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function projectionHorizonFromStrategy(strategy: StrategyConfig): number {
  const size = strategy.candidateShortlistSize;
  if (size <= 5) return 6;
  if (size <= 10) return 8;
  return 10;
}

export function shouldProjectForTurn(
  showProjection: boolean,
  isUserTurn: boolean,
  currentOverallPick: number | null,
  alreadyProjected: ReadonlySet<number>
): number | null {
  if (!showProjection || isUserTurn) return null;
  if (currentOverallPick == null || currentOverallPick <= 0) return null;
  if (alreadyProjected.has(currentOverallPick)) return null;
  return currentOverallPick;
}