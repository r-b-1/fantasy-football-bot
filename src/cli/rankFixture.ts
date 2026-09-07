import { loadLeagueConfig, loadStrategyConfig } from "../config/load.js";
import { loadDraftFixture } from "../data/fixture.js";
import { loadRosterGrid } from "../data/rosterGrid.js";
import { loadSportslineWorkbook } from "../data/sportsline.js";
import type { LivePlayer } from "../domain/types.js";
import { predictNextPicks } from "../ai/predict.js";
import { formatProjection } from "./format.js";
import { recommendTurn } from "../engine/recommend.js";
import { buildDraftStateFromFixture, toLivePlayers } from "../engine/state.js";

export interface RankFixtureOptions {
  fixturePath: string;
  leaguePath: string;
  strategyPath: string;
  sportslinePath: string;
  eventLogPath?: string;
  useAI?: boolean;
}

export async function rankFixture(options: RankFixtureOptions): Promise<string> {
  const league = loadLeagueConfig(options.leaguePath);
  const strategy = loadStrategyConfig(options.strategyPath);
  const players = loadSportslineWorkbook(options.sportslinePath);
  const fixture = loadDraftFixture(options.fixturePath);
  const { state } = buildDraftStateFromFixture(players, fixture, league, strategy);
  const result = await recommendTurn({
    players,
    state,
    league,
    strategy,
    useAI: options.useAI,
    eventLogPath: options.eventLogPath,
    explain: "all"
  });
  return result.output;
}

export interface PredictFixtureOptions {
  fixturePath: string;
  leaguePath: string;
  strategyPath: string;
  sportslinePath: string;
  useAI?: boolean;
  horizon?: number;
}

export async function predictFixture(options: PredictFixtureOptions): Promise<string> {
  const league = loadLeagueConfig(options.leaguePath);
  const strategy = loadStrategyConfig(options.strategyPath);
  const players = loadSportslineWorkbook(options.sportslinePath);
  const fixture = loadDraftFixture(options.fixturePath);
  const { state } = buildDraftStateFromFixture(players, fixture, league, strategy);
  const livePlayers: LivePlayer[] = toLivePlayers(players, new Set());
  const rosterGrid = league.rosterGridPath ? loadRosterGrid(league.rosterGridPath) : undefined;
  const projection = await predictNextPicks({
    players: livePlayers,
    state,
    league,
    strategy,
    useAI: options.useAI,
    horizon: options.horizon,
    rosterGrid
  });
  return formatProjection(projection);
}