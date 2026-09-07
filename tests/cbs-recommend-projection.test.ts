import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadLeagueConfig, loadStrategyConfig } from "../src/config/load.js";
import { loadRosterGrid } from "../src/data/rosterGrid.js";
import { resolveProjectionKeepers } from "../src/data/leagueKeepers.js";
import { loadSportslineWorkbook } from "../src/data/sportsline.js";
import { startFixtureServer, type FixtureServer } from "../src/cbs/fixtureServer.js";
import { runRecommendPollLoop } from "../src/cbs/recommend.js";
import { loadSelectorConfig } from "../src/cbs/selectors.js";
import { closeSession, openEphemeralBrowser, type CBSSession } from "../src/cbs/session.js";

const league = loadLeagueConfig("config/league.current.json");
const strategy = loadStrategyConfig("config/strategy.current.json");
const selectors = loadSelectorConfig("config/selectors.fixture.json");

describe("recommend poll loop projection", () => {
  let server: FixtureServer;
  let session: CBSSession;

  beforeAll(async () => {
    server = await startFixtureServer();
    session = await openEphemeralBrowser(true);
    await session.page.goto(`${server.url}?autoplay=1&pauseAt=2&intervalMs=80`, {
      waitUntil: "domcontentloaded"
    });
    await session.page.waitForFunction(() => {
      const el = document.querySelector("[data-testid='current-pick']");
      return el?.textContent?.trim() === "2";
    });
  }, 60000);

  afterAll(async () => {
    if (session) await closeSession(session);
    if (server) await server.close();
  });

  it("projects upcoming picks while another team is on the clock", async () => {
    const players = loadSportslineWorkbook("data/reference/cheatsheet_cbsppr12.xlsx");
    const projected: number[] = [];
    const recommended: number[] = [];
    const previews: Array<{ overallPick: number; teamName: string; output: string }> = [];
    await runRecommendPollLoop({
      page: session.page,
      selectors,
      league,
      strategy,
      players,
      useAI: false,
      showProjection: true,
      rosterGrid: league.rosterGridPath ? loadRosterGrid(league.rosterGridPath) : undefined,
      keepers: resolveProjectionKeepers(league),
      intervalMs: 80,
      untilPick: 2,
      onProjection: (overallPick) => projected.push(overallPick),
      onRecommendation: (overallPick) => recommended.push(overallPick),
      onOnClockPreview: (info) => previews.push(info)
    });
    expect(projected).toEqual([2]);
    expect(recommended).toEqual([]);
    expect(previews).toHaveLength(1);
    expect(previews[0]?.teamName).toBe("Gibbs me a win");
    expect(previews[0]?.output).toMatch(/LIKELY PICK FOR Gibbs me a win/);
    expect(previews[0]?.output).toMatch(/Mode: RECOMMEND/);
    expect(previews[0]?.output).toMatch(/Fallback:/);
  });
});
