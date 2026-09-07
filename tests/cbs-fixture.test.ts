import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadLeagueConfig, loadStrategyConfig } from "../src/config/load.js";
import { loadSportslineWorkbook } from "../src/data/sportsline.js";
import { CBSExecutor } from "../src/cbs/executor.js";
import { startFixtureServer, type FixtureServer } from "../src/cbs/fixtureServer.js";
import { CBSReader } from "../src/cbs/reader.js";
import {
  assertLiveSelectorConfig,
  loadSelectorConfig
} from "../src/cbs/selectors.js";
import { closeSession, openEphemeralBrowser, type CBSSession } from "../src/cbs/session.js";
import { isAllowedCbsUrl } from "../src/cbs/allowlist.js";

const league = loadLeagueConfig("config/league.current.json");
const strategy = loadStrategyConfig("config/strategy.current.json");
const selectors = loadSelectorConfig("config/selectors.fixture.json");

describe("local fake draft room", () => {
  let server: FixtureServer;
  let session: CBSSession;

  beforeAll(async () => {
    server = await startFixtureServer();
    session = await openEphemeralBrowser(true);
    await session.page.goto(`${server.url}?autoplay=1&pauseAt=3&intervalMs=80`, {
      waitUntil: "domcontentloaded"
    });
    await session.page.waitForFunction(() => {
      const el = document.querySelector("[data-testid='current-pick']");
      return el?.textContent?.trim() === "3";
    });
  }, 60000);

  afterAll(async () => {
    if (session) await closeSession(session);
    if (server) await server.close();
  });

  it("never points the browser at CBS", () => {
    expect(isAllowedCbsUrl(session.page.url())).toBe(false);
    expect(session.page.url()).toMatch(/127\.0\.0\.1/);
    expect(session.page.url()).toMatch(/fixture-draft-room/);
  });

  it("lets the read-only reader see pick 3 and Pickens My Jeanty on the clock", async () => {
    const players = loadSportslineWorkbook("data/reference/cheatsheet_cbsppr12.xlsx");
    const reader = new CBSReader(session.page, selectors, league);
    const snapshot = await reader.readLiveSnapshot(players);
    expect(snapshot.control.currentOverallPick).toBe(3);
    expect(snapshot.control.teamOnClock).toBe("Pickens My Jeanty");
    expect(snapshot.control.isUserTurn).toBe(true);
    expect(snapshot.control.youAreUp).toBe(true);
    expect(snapshot.results.map((result) => result.playerName)).toEqual([
      "Jahmyr Gibbs",
      "Bijan Robinson"
    ]);
    expect(snapshot.roster.some((row) => row.name.includes("Ashton Jeanty"))).toBe(true);
  });

  it("refuses to execute a pick against the fake room", async () => {
    const executor = new CBSExecutor(session.page, selectors, league, strategy);
    await expect(
      executor.executePick(
        {
          player: {
            id: "puka nacua::WR",
            sourceName: "Puka Nacua",
            name: "Puka Nacua",
            position: "WR",
            sportslineRating: 100,
            adp: 6.67,
            listedRound: 1,
            byeWeek: 11,
            available: true
          },
          score: 86,
          components: {
            sportslineRating: 100,
            adpValue: 50,
            rosterNeed: 90,
            scarcity: 90,
            nextPickRisk: 80,
            tierCliff: 90,
            penalties: 0
          },
          notes: []
        },
        {
          currentOverallPick: 3,
          nextUserOverallPick: 21,
          teamOnClock: league.userTeamName,
          isUserTurn: true,
          clockSecondsRemaining: 20,
          snapshotAt: "test",
          roster: { players: [] },
          draftEvents: [],
          availablePlayerIds: new Set(),
          recentPositionCounts: {},
          warnings: []
        }
      )
    ).rejects.toThrow(/will not act on the local fake room/);
  });

  it("keeps fixture selectors out of the live CBS path", () => {
    expect(() => assertLiveSelectorConfig(selectors)).toThrow(/cannot be used against live CBS/);
  });
});
