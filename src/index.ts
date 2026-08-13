import "dotenv/config";
import path from "node:path";
import { loadLeagueConfig, loadStrategyConfig } from "./config/load.js";
import { loadSportslineWorkbook } from "./data/sportsline.js";
import type { DraftState, LivePlayer } from "./domain/types.js";
import { scoreCandidates } from "./engine/scoring.js";
import { chooseWithAI } from "./ai/openai.js";

const leaguePath = process.env.LEAGUE_CONFIG ?? "config/league.current.json";
const strategyPath = process.env.STRATEGY_CONFIG ?? "config/strategy.current.json";
const sportslinePath = process.env.SPORTSLINE_XLSX ?? "data/reference/cheatsheet_cbsppr12.xlsx";

async function rankDemo(): Promise<void> {
  const league = loadLeagueConfig(leaguePath);
  const strategy = loadStrategyConfig(strategyPath);
  const players = loadSportslineWorkbook(sportslinePath);

  // Demo state only. Real state comes from CBSReader or replay fixtures.
  const keepers = new Set(league.keepers.map((k) => `${k.name.toLowerCase()}::${k.position}`));
  const available: LivePlayer[] = players
    .filter((p) => !keepers.has(p.id))
    .map((p) => ({ ...p, available: true }));

  const state: DraftState = {
    currentOverallPick: 3,
    nextUserOverallPick: 21,
    teamOnClock: league.userTeamName,
    isUserTurn: true,
    clockSecondsRemaining: null,
    snapshotAt: new Date().toISOString(),
    roster: {
      players: league.keepers.map((k) => ({
        playerId: `${k.name.toLowerCase()}::${k.position}`,
        name: k.name,
        position: k.position,
        source: "keeper" as const
      }))
    },
    draftEvents: [],
    availablePlayerIds: new Set(available.map((p) => p.id)),
    recentPositionCounts: {}
  };

  const ranked = scoreCandidates(available, state, league, strategy).slice(
    0,
    strategy.candidateShortlistSize
  );

  console.table(
    ranked.map((c) => ({
      player: c.player.name,
      pos: c.player.position,
      score: c.score,
      rating: c.player.sportslineRating,
      adp: c.player.adp,
      adpValue: c.components.adpValue.toFixed(1),
      need: c.components.rosterNeed.toFixed(1),
      scarcity: c.components.scarcity.toFixed(1)
    }))
  );

  const decision = await chooseWithAI(ranked, state, league, {
    model: process.env.OPENAI_MODEL ?? "gpt-5.6",
    reasoningEffort: (process.env.OPENAI_REASONING_EFFORT as "low") ?? "low",
    timeoutMs: strategy.aiTimeoutMs,
    confidenceThreshold: strategy.aiConfidenceThreshold
  });

  console.log("Decision:", decision);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "rank-demo";
  if (command === "rank-demo") {
    await rankDemo();
    return;
  }
  if (command === "cbs-monitor") {
    console.error(
      "CBS monitor is intentionally not implemented until selectors are captured from the real logged-in page. Read docs/CBS_INTEGRATION.md."
    );
    process.exitCode = 2;
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
