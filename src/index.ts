import "dotenv/config";
import { rankFixture, predictFixture } from "./cli/rankFixture.js";
import { renderReplayDemo } from "./cli/replayDemo.js";
import { runCbsDiagnose } from "./cbs/diagnose.js";
import { runFixtureConfirm } from "./cbs/fixtureConfirm.js";
import { runFixtureMonitor } from "./cbs/fixtureMonitor.js";
import { runCbsMonitor } from "./cbs/monitor.js";
import { runCbsMockDraft, runCbsRecommend } from "./cbs/recommend.js";
import { loadLeagueConfig, loadStrategyConfig } from "./config/load.js";
import { loadSportslineWorkbook } from "./data/sportsline.js";
import type { DraftState, LivePlayer } from "./domain/types.js";
import { generateShortlist } from "./engine/shortlist.js";
import { nextUserOverallPick } from "./engine/state.js";
import { formatShortlist } from "./cli/format.js";

const leaguePath = process.env.LEAGUE_CONFIG ?? "config/league.current.json";
const strategyPath = process.env.STRATEGY_CONFIG ?? "config/strategy.current.json";
const sportslinePath = process.env.SPORTSLINE_XLSX ?? "data/reference/cheatsheet_cbsppr12.xlsx";

function rankDemo(): void {
  const league = loadLeagueConfig(leaguePath);
  const strategy = loadStrategyConfig(strategyPath);
  const players = loadSportslineWorkbook(sportslinePath);
  const keeperIds = new Set(
    league.keepers.map((keeper) => {
      const match = players.find(
        (player) =>
          player.name.toLowerCase() === keeper.name.toLowerCase() &&
          player.position === keeper.position
      );
      if (!match) {
        throw new Error(`League keeper ${keeper.name} (${keeper.position}) was not found in SportsLine`);
      }
      return match.id;
    })
  );

  const available: LivePlayer[] = players.map((player) => ({
    ...player,
    available: !keeperIds.has(player.id)
  }));

  const state: DraftState = {
    currentOverallPick: 3,
    nextUserOverallPick: nextUserOverallPick(3, league.knownOverallPicks),
    teamOnClock: league.userTeamName,
    isUserTurn: true,
    clockSecondsRemaining: null,
    snapshotAt: new Date().toISOString(),
    roster: {
      players: league.keepers.map((keeper) => {
        const match = players.find(
          (player) =>
            player.name.toLowerCase() === keeper.name.toLowerCase() &&
            player.position === keeper.position
        );
        return {
          playerId: match?.id ?? `${keeper.name.toLowerCase()}::${keeper.position}`,
          name: keeper.name,
          position: keeper.position,
          byeWeek: match?.byeWeek ?? null,
          source: "keeper" as const
        };
      })
    },
    draftEvents: [],
    availablePlayerIds: new Set(available.filter((player) => player.available).map((player) => player.id)),
    recentPositionCounts: {},
    warnings: league.notes
  };

  const ranked = generateShortlist(available, state, league, strategy);
  console.log(formatShortlist(ranked, state, league));
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "rank-demo";
  if (command === "rank-demo") {
    rankDemo();
    return;
  }
  if (command === "rank-fixture") {
    const fixturePath = process.argv[3];
    if (!fixturePath) {
      console.error("Usage: npm run rank:fixture -- fixtures/pick-21.json");
      process.exitCode = 2;
      return;
    }
    const output = await rankFixture({
      fixturePath,
      leaguePath,
      strategyPath,
      sportslinePath,
      eventLogPath: process.env.EVENT_LOG
    });
    console.log(output);
    return;
  }
  if (command === "decide-fixture") {
    const fixturePath = process.argv[3];
    if (!fixturePath) {
      console.error("Usage: npm run decide:fixture -- fixtures/pick-21.json");
      process.exitCode = 2;
      return;
    }
    const output = await rankFixture({
      fixturePath,
      leaguePath,
      strategyPath,
      sportslinePath,
      eventLogPath: process.env.EVENT_LOG,
      useAI: true
    });
    console.log(output);
    return;
  }
  if (command === "predict-fixture") {
    const fixturePath = process.argv[3];
    if (!fixturePath) {
      console.error("Usage: npm run predict:fixture -- fixtures/pick-21.json");
      process.exitCode = 2;
      return;
    }
    const output = await predictFixture({
      fixturePath,
      leaguePath,
      strategyPath,
      sportslinePath,
      useAI: !process.argv.includes("--no-ai")
    });
    console.log(output);
    return;
  }
  if (command === "demo-replay") {
    console.log(
      renderReplayDemo({
        scriptPath: process.argv[3] ?? "fixtures/pick-35.json",
        leaguePath,
        strategyPath,
        sportslinePath
      })
    );
    return;
  }
  if (command === "cbs-fixture") {
    await runFixtureMonitor({
      headless: process.argv.includes("--headless"),
      pauseAt: Number(process.env.FIXTURE_PAUSE_AT ?? "0"),
      untilPick: Number(process.env.FIXTURE_UNTIL_PICK ?? "35")
    });
    return;
  }
  if (command === "cbs-fixture-confirm") {
    const everyPickIsUser =
      process.argv.includes("--every-pick-user") || process.env.FIXTURE_EVERY_PICK_USER === "1";
    await runFixtureConfirm({
      headless: process.argv.includes("--headless"),
      autoConfirm: process.argv.includes("--auto-confirm"),
      everyPickIsUser,
      untilPick: Number(process.env.FIXTURE_UNTIL_PICK ?? (everyPickIsUser ? "10" : "35"))
    });
    return;
  }
  if (command === "cbs-diagnose") {
    await runCbsDiagnose({ mock: process.argv.includes("--mock") });
    return;
  }
  if (command === "cbs-monitor") {
    await runCbsMonitor();
    return;
  }
  if (command === "cbs-recommend") {
    await runCbsRecommend({ useAI: !process.argv.includes("--no-ai") });
    return;
  }
  if (command === "cbs-mock") {
    await runCbsMockDraft({ useAI: !process.argv.includes("--no-ai") });
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
