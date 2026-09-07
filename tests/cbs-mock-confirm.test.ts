import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { DEFAULT_CBS_MOCK_DRAFT_URL, isCbsMockDraftRoom } from "../src/cbs/allowlist.js";
import { performConfiguredPickClicks } from "../src/cbs/configuredClicks.js";
import {
  clickLocatorBlock,
  configExecutionBlock,
  hostExecutionBlock,
  snapshotExecutionBlock
} from "../src/cbs/executionGates.js";
import { loadLeagueConfig } from "../src/config/load.js";
import fs from "node:fs";
import { loadSelectorConfig, requiredClickSelectors, resolveMockSelectorConfigPath } from "../src/cbs/selectors.js";

const mockLeague = loadLeagueConfig("config/league.mock.confirm.json");
const liveLeague = loadLeagueConfig("config/league.current.json");
const mockSelectors = loadSelectorConfig("config/selectors.mock.json");

describe("mock confirm gates", () => {
  it("allows only public mock draft rooms for clicks", () => {
    expect(hostExecutionBlock("https://mockdraft-1.football.cbssports.com/mockdraft/standard")).toBeNull();
    expect(isCbsMockDraftRoom("https://mockdraft-1.football.cbssports.com/mockdraft/standard")).toBe(true);
    expect(hostExecutionBlock("https://allfam.football.cbssports.com/draft/live/room2")?.kind).toBe("league_room");
    expect(hostExecutionBlock("http://127.0.0.1:4000/fixture-draft-room")?.kind).toBe("fixture");
    expect(hostExecutionBlock(DEFAULT_CBS_MOCK_DRAFT_URL)?.kind).toBe("not_mock_room");
    expect(
      hostExecutionBlock("https://mockdraft35-2860135.football.cbssports.com/draft/live/room2")
    ).toBeNull();
  });

  it("requires confirm config and captured click locators", () => {
    expect(configExecutionBlock(mockLeague)).toBeNull();
    expect(configExecutionBlock(liveLeague)?.kind).toBe("execution_disabled");
    expect(requiredClickSelectors(mockSelectors)).toEqual(["draftAction"]);
    expect(clickLocatorBlock(mockSelectors)?.kind).toBe("missing_locators");
    const previous = process.env.SELECTOR_CONFIG;
    process.env.SELECTOR_CONFIG = "config/selectors.local.json";
    try {
      expect(resolveMockSelectorConfigPath()).toBe(
        fs.existsSync("config/selectors.local.json")
          ? "config/selectors.local.json"
          : "config/selectors.mock.json"
      );
    } finally {
      if (previous == null) delete process.env.SELECTOR_CONFIG;
      else process.env.SELECTOR_CONFIG = previous;
    }
    if (fs.existsSync("config/selectors.local.json")) {
      const local = loadSelectorConfig("config/selectors.local.json");
      expect(requiredClickSelectors(local)).toEqual([]);
      expect(local.selectors.draftAction).toContain("fantasyButtonSm");
      expect(local.selectors.draftAction).toContain("Draft");
    }
    expect(mockSelectors.draftRoomUrlPattern).toContain("mockdraft");
  });

  it("fails closed on duplicate, wrong turn, stale pick, and already-drafted player", () => {
    const base = {
      isUserTurn: true,
      teamOnClock: "Slot Three",
      userTeamName: "Slot Three",
      currentOverallPick: 3,
      expectedOverallPick: 3,
      clockSecondsRemaining: 25,
      minimumExecutionClockSeconds: 8,
      results: [] as Array<{ overallPick: number; fantasyTeam: string; playerName: string }>,
      playerName: "Puka Nacua",
      completed: new Set<number>(),
      disabledReason: null as string | null
    };
    expect(snapshotExecutionBlock(base)).toBeNull();
    expect(snapshotExecutionBlock({ ...base, completed: new Set([3]) })?.kind).toBe("duplicate");
    expect(snapshotExecutionBlock({ ...base, isUserTurn: false })?.kind).toBe("not_our_turn");
    expect(snapshotExecutionBlock({ ...base, currentOverallPick: 4 })?.kind).toBe("stale_pick");
    expect(
      snapshotExecutionBlock({
        ...base,
        results: [{ overallPick: 1, fantasyTeam: "Other", playerName: "Puka Nacua" }]
      })?.kind
    ).toBe("unavailable");
    expect(
      snapshotExecutionBlock({
        ...base,
        results: [{ overallPick: 1, fantasyTeam: "Other", playerName: "Nacua, Puka (WR LAR)" }]
      })?.kind
    ).toBe("unavailable");
    expect(snapshotExecutionBlock({ ...base, clockSecondsRemaining: 2 })?.kind).toBe("clock");
    expect(snapshotExecutionBlock({ ...base, disabledReason: "prior fail" })?.kind).toBe("disabled");
  });
});

describe("configured pick clicks on a local fixture", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser.close();
  });

  it("fills the configured search box and clicks draft then confirm", async () => {
    await page.setContent(`<!DOCTYPE html>
      <html><body>
        <input data-testid="player-search" />
        <button data-testid="draft-action" type="button">Draft</button>
        <button data-testid="draft-confirmation" type="button">Confirm</button>
        <script>
          document.querySelector("[data-testid='draft-action']").addEventListener("click", function () {
            window.__pending = document.querySelector("[data-testid='player-search']").value;
          });
          document.querySelector("[data-testid='draft-confirmation']").addEventListener("click", function () {
            window.__drafted = window.__pending;
          });
        </script>
      </body></html>`);
    await performConfiguredPickClicks(
      page,
      {
        currentPick: null,
        teamOnClock: null,
        youAreUpIndicator: null,
        countdownClock: null,
        playerRows: null,
        playerNameWithinRow: null,
        playerPositionWithinRow: null,
        playerNflTeamWithinRow: null,
        draftResultRows: null,
        draftResultPickWithinRow: null,
        draftResultTeamWithinRow: null,
        draftResultPlayerWithinRow: null,
        userRosterRows: null,
        playerSearchInput: "[data-testid='player-search']",
        draftAction: "[data-testid='draft-action']",
        draftConfirmation: "[data-testid='draft-confirmation']"
      },
      "Jahmyr Gibbs"
    );
    expect(await page.evaluate("window.__drafted")).toBe("Jahmyr Gibbs");
  });

  it("clicks the player name then Draft in the popup", async () => {
    await page.setContent(`<!DOCTYPE html>
      <html><body>
        <table id="playerListDD">
          <tr id="playerListDD_1"><td><a href="#nico">Collins, Nico</a></td></tr>
        </table>
        <div id="DraftRoom.views.PlayerPopup" hidden>
          <button data-testid="draft-action" type="button">Draft</button>
        </div>
        <script>
          document.querySelector("#playerListDD_1 a").addEventListener("click", function (event) {
            event.preventDefault();
            document.getElementById("DraftRoom.views.PlayerPopup").hidden = false;
          });
          document.querySelector("[data-testid='draft-action']").addEventListener("click", function () {
            window.__drafted = "Collins, Nico";
          });
        </script>
      </body></html>`);
    await performConfiguredPickClicks(
      page,
      {
        currentPick: null,
        teamOnClock: null,
        youAreUpIndicator: null,
        countdownClock: null,
        playerRows: "table#playerListDD tr[id^='playerListDD_']",
        playerNameWithinRow: "td:nth-child(1)",
        playerPositionWithinRow: null,
        playerNflTeamWithinRow: null,
        draftResultRows: null,
        draftResultPickWithinRow: null,
        draftResultTeamWithinRow: null,
        draftResultPlayerWithinRow: null,
        userRosterRows: null,
        playerSearchInput: null,
        draftAction: "[data-testid='draft-action']",
        draftConfirmation: null
      },
      "Collins, Nico"
    );
    expect(await page.evaluate("window.__drafted")).toBe("Collins, Nico");
  });

  it("matches CBS Last, First rows and clicks only the visible Draft control", async () => {
    await page.setContent(`<!DOCTYPE html>
      <html><body>
        <table id="playerListDD">
          <tr id="playerListDD_1"><td><a href="#breece">Hall, Breece</a></td></tr>
        </table>
        <form id="unlistedPlayerForm" style="display:none">
          <input class="fantasyButtonSm" type="button" value="Draft" data-testid="hidden-draft" />
        </form>
        <input class="fantasyButtonSm" type="button" value="Queue" />
        <input class="fantasyButtonSm" type="button" value="Draft" data-testid="visible-draft" />
        <script>
          document.querySelector("[data-testid='visible-draft']").addEventListener("click", function () {
            window.__drafted = "Hall, Breece";
          });
          document.querySelector("[data-testid='hidden-draft']").addEventListener("click", function () {
            window.__drafted = "HIDDEN";
          });
        </script>
      </body></html>`);
    await performConfiguredPickClicks(
      page,
      {
        currentPick: null,
        teamOnClock: null,
        youAreUpIndicator: null,
        countdownClock: null,
        playerRows: "table#playerListDD tr[id^='playerListDD_']",
        playerNameWithinRow: "td:nth-child(1)",
        playerPositionWithinRow: null,
        playerNflTeamWithinRow: null,
        draftResultRows: null,
        draftResultPickWithinRow: null,
        draftResultTeamWithinRow: null,
        draftResultPlayerWithinRow: null,
        userRosterRows: null,
        playerSearchInput: null,
        draftAction: "input.fantasyButtonSm[type='button'][value='Draft']",
        draftConfirmation: null
      },
      "Breece Hall"
    );
    expect(await page.evaluate("window.__drafted")).toBe("Hall, Breece");
  });
});
