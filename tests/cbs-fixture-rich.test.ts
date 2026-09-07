import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadLeagueConfig, loadStrategyConfig } from "../src/config/load.js";
import { loadSportslineWorkbook } from "../src/data/sportsline.js";
import { startFixtureServer, type FixtureServer } from "../src/cbs/fixtureServer.js";
import { CBSReader } from "../src/cbs/reader.js";
import { loadSelectorConfig } from "../src/cbs/selectors.js";
import { closeSession, openEphemeralBrowser, type CBSSession } from "../src/cbs/session.js";
import { isAllowedCbsUrl } from "../src/cbs/allowlist.js";
import type { LivePlayer } from "../src/domain/types.js";
import { toLivePlayers } from "../src/engine/state.js";

const league = loadLeagueConfig("config/league.current.json");
const strategy = loadStrategyConfig("config/strategy.current.json");
const selectors = loadSelectorConfig("config/selectors.fixture.json");

describe("rich local fake draft room (16-team)", () => {
  let server: FixtureServer;
  let session: CBSSession;

  beforeAll(async () => {
    server = await startFixtureServer();
    session = await openEphemeralBrowser(true);
    await session.page.goto(
      `${server.richUrl}?autoplay=1&pauseOnUser=0&intervalMs=80&userSeconds=2&autoSeconds=1&untilPick=5`,
      { waitUntil: "domcontentloaded" }
    );
    await session.page.waitForFunction(
      () => (window as unknown as { __runComplete?: boolean }).__runComplete === true,
      null,
      { timeout: 5000 }
    );
  }, 60000);

  afterAll(async () => {
    if (session) await closeSession(session);
    if (server) await server.close();
  });

  it("never points the browser at CBS", () => {
    expect(isAllowedCbsUrl(session.page.url())).toBe(false);
    expect(session.page.url()).toMatch(/fixture-draft-room-rich/);
  });

  it("auto-picks non-user teams and computes snake slots correctly", async () => {
    const sportsline = loadSportslineWorkbook("data/reference/cheatsheet_cbsppr12.xlsx");
    const players: LivePlayer[] = toLivePlayers(sportsline, new Set());
    const reader = new CBSReader(session.page, selectors, league);
    const snapshot = await reader.readLiveSnapshot(players);
    const results = snapshot.results;
    expect(snapshot.control.currentOverallPick).toBeGreaterThanOrEqual(5);
    expect(results.length).toBeGreaterThanOrEqual(4);
    expect(results.some((r) => r.fantasyTeam === "Hairy Butterscotch"), "slot 1").toBe(true);
    expect(results.some((r) => r.fantasyTeam === "Gibbs me a win"), "slot 2").toBe(true);
    expect(results.some((r) => r.fantasyTeam === "Chase'n my Puka"), "slot 4").toBe(true);
    expect(new Set(results.map((r) => r.fantasyTeam)).size).toBeGreaterThanOrEqual(2);
    const keeperNames = await session.page.evaluate(() =>
      (window as unknown as { __script: { keepers: Array<{ name: string }> } }).__script.keepers.map((keeper) => keeper.name)
    );
    expect(results.every((result) => !keeperNames.includes(result.playerName))).toBe(true);
    expect(results[0]?.playerName).toBe("Josh Jacobs");
  });
});
