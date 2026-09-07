import { expect, it } from "vitest";
import { loadLeagueConfig, loadStrategyConfig } from "../src/config/load.js";
import { loadSportslineWorkbook } from "../src/data/sportsline.js";
import { playerKey } from "../src/data/normalize.js";
import { POSITIONS } from "../src/domain/types.js";
import { FixtureExecutor } from "../src/cbs/fixtureExecutor.js";
import { startFixtureServer } from "../src/cbs/fixtureServer.js";
import { CBSReader } from "../src/cbs/reader.js";
import { loadSelectorConfig } from "../src/cbs/selectors.js";
import { closeSession, openEphemeralBrowser } from "../src/cbs/session.js";
import type { RichFixtureScript } from "../src/cbs/fixtureData.js";
import { recommendTurn } from "../src/engine/recommend.js";

it("completes the 158-pick fake draft with keeper exclusions and the configured user picks", async () => {
  const league = loadLeagueConfig("config/league.current.json");
  const strategy = loadStrategyConfig("config/strategy.current.json");
  const players = loadSportslineWorkbook("data/reference/cheatsheet_cbsppr12.xlsx");
  const selectors = loadSelectorConfig("config/selectors.fixture.json");
  const server = await startFixtureServer();
  const session = await openEphemeralBrowser(true);
  const browserErrors: string[] = [];
  const externalRequests: string[] = [];
  session.page.on("pageerror", (error) => browserErrors.push(error.message));
  await session.page.route("**/*", (route) => {
    if (new URL(route.request().url()).origin !== new URL(server.richUrl).origin) {
      externalRequests.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });

  try {
    await session.page.goto(`${server.richUrl}?autoplay=1&intervalMs=1&autoSeconds=1&untilPick=158`);
    await session.page.waitForFunction(() => Boolean((window as unknown as { __script?: unknown }).__script));
    const script = await session.page.evaluate(() => (window as unknown as { __script: RichFixtureScript }).__script);
    const keeperIds = new Set(script.keepers.map((keeper) => playerKey(keeper.name, keeper.position)));
    const reader = new CBSReader(session.page, selectors, league);
    const executor = new FixtureExecutor(session.page, reader, selectors, league, strategy);

    for (;;) {
      await session.page.waitForFunction(() => {
        const room = window as unknown as { __waitingForUser: boolean; __runComplete: boolean };
        return room.__waitingForUser || room.__runComplete;
      }, null, { timeout: 15000 });
      if (await session.page.evaluate(() => (window as unknown as { __runComplete: boolean }).__runComplete)) break;

      const state = await reader.readDraftState(players, { recentPickWindow: strategy.recentPickWindow });
      for (const id of keeperIds) state.availablePlayerIds.delete(id);
      const recommendation = await recommendTurn({ players, state, league, strategy, useAI: false });
      const selected = recommendation.ranked.find((candidate) => candidate.player.id === recommendation.decision.selectedCandidateId)!;
      expect(keeperIds.has(selected.player.id)).toBe(false);
      const corePositions = ["QB", "RB", "WR", "TE"] as const;
      const missingCore = corePositions.filter((position) =>
        state.roster.players.filter((player) => player.position === position).length < league.lineup[position]
      );
      if (missingCore.length > 0) {
        expect(recommendation.ranked.every((candidate) =>
          state.roster.players.filter((player) => player.position === candidate.player.position).length < league.lineup[candidate.player.position]
        ), "Do not offer backups while core starters are missing").toBe(true);
      }
      await executor.executeConfirmedPick(selected, state.currentOverallPick);
      console.log(`Fake pick ${state.currentOverallPick}: ${selected.player.name} (${selected.player.position}), score ${selected.score.toFixed(2)}`);
    }

    const results = await reader.readDraftResults();
    const state = await reader.readDraftState(players);
    const positionCounts = Object.fromEntries(POSITIONS.map((position) => [
      position, state.roster.players.filter((player) => player.position === position).length
    ]));
    console.log("Fake draft summary:", JSON.stringify({
      picks: results.length,
      keepers: script.keepers.length,
      userPicks: executor.completedPicks,
      roster: state.roster.players.map((player) => `${player.name} (${player.position}, ${player.source})`),
      positionCounts,
      unfilledStarters: POSITIONS.filter((position) => positionCounts[position]! < league.lineup[position])
    }, null, 2));

    expect(results).toHaveLength(158);
    expect(results.map((result) => result.overallPick)).toEqual(Array.from({ length: 158 }, (_, index) => index + 1));
    expect(new Set(results.map((result) => result.playerName)).size).toBe(158);
    expect(results.filter((result) => script.keepers.some((keeper) => keeper.name === result.playerName))).toEqual([]);
    expect(browserErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
    expect(state.roster.players).toHaveLength(12);
    for (const position of POSITIONS) {
      expect(positionCounts[position], `Fill ${position} starters in this simulation`).toBeGreaterThanOrEqual(league.lineup[position]);
    }
    expect(positionCounts.QB).toBeLessThanOrEqual(league.lineup.QB + 1);
    expect(executor.isDisabled).toBe(false);
    expect(executor.completedPicks).toEqual(league.knownOverallPicks);
  } finally {
    await closeSession(session);
    await server.close();
  }
}, 120000);
