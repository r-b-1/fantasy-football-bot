import type {
  DraftState,
  LeagueConfig,
  LivePlayer,
  NextPicksProjection,
  ProjectedPick,
  StrategyConfig
} from "../domain/types.js";

export interface DeterministicProjectionOptions {
  horizon?: number;
}

export function deterministicProjection(
  players: LivePlayer[],
  state: DraftState,
  league: LeagueConfig,
  strategy: StrategyConfig,
  options: DeterministicProjectionOptions = {}
): NextPicksProjection {
  const horizon = options.horizon ?? 6;
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