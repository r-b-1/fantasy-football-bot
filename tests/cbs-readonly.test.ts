import { describe, expect, it } from "vitest";
import {
  DEFAULT_CBS_MOCK_DRAFT_URL,
  isAllInTheFamilyHost,
  isAllowedCbsUrl,
  isAllowedFixtureUrl,
  isCbsMockDraftRoom,
  leagueOrigin,
  leagueStartUrl,
  looksLikeCbsDraftRoom,
  looksLikeCbsMockDraftLobby,
  pickDraftRoomUrl
} from "../src/cbs/allowlist.js";
import { detectConfigConflicts } from "../src/cbs/conflicts.js";
import { shouldInspectFrame } from "../src/cbs/inspect.js";
import { parseClockSeconds, parseOverallPick, parseOverallPickLenient, parseTeamOnClock, interpretYouAreUp, classifyMockRoomPhase, playerPopupLooksOpen, looksLikeDraftActionLabel, toCbsLastFirst, playerNamesEquivalent, formatClockSeconds, formatClockDuration, formatOnClockStatus } from "../src/cbs/parse.js";
import { canonicalizeMockDraftUrl, persistMockDraftStartUrl, resolveMockDraftStartUrl } from "../src/cbs/mockStartUrl.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyMockRoomFacts, extractPickIntervalRaw, formatPickInterval, mergeDraftOrder, ownerFromDraftOrder, parseListedTeamCount, parsePickIntervalSeconds, parseScoringFormat, parseTeamLabels } from "../src/cbs/roomFacts.js";
import { resyncFromDraftResults } from "../src/cbs/resync.js";
import { loadLeagueConfig } from "../src/config/load.js";
import { loadSportslineWorkbook } from "../src/data/sportsline.js";
import { explainCbsProfileLaunchError, resolveCbsBrowserProfileDir } from "../src/cbs/session.js";
import { isMockSelectorConfig, loadSelectorConfig, requiredReadSelectors, resolveSelectorConfigPath } from "../src/cbs/selectors.js";

describe("CBS allowlist", () => {
  it("allows CBS sports hosts and rejects others", () => {
    expect(isAllowedCbsUrl("https://allfam.football.cbssports.com/draft")).toBe(true);
    expect(isAllowedCbsUrl("https://www.cbssports.com/login")).toBe(true);
    expect(isAllowedCbsUrl("https://example.com")).toBe(false);
    expect(isAllowedFixtureUrl("http://127.0.0.1:9/fixture-draft-room")).toBe(true);
    expect(isAllowedFixtureUrl("https://allfam.football.cbssports.com/draft")).toBe(false);
    expect(isAllowedCbsUrl("http://127.0.0.1:9/fixture-draft-room")).toBe(false);
    expect(leagueOrigin("allfam.football.cbssports.com")).toBe("https://allfam.football.cbssports.com/");
    expect(leagueStartUrl("allfam.football.cbssports.com")).toBe("https://allfam.football.cbssports.com/");
    expect(leagueStartUrl("allfam.football.cbssports.com/draft/live/room2")).toBe(
      "https://allfam.football.cbssports.com/draft/live/room2"
    );
    expect(leagueStartUrl("https://allfam.football.cbssports.com/draft/live/room2/")).toBe(
      "https://allfam.football.cbssports.com/draft/live/room2"
    );
  });

  it("treats league feed as logged-in CBS but not a draft room", () => {
    expect(
      looksLikeCbsDraftRoom("https://allfam.football.cbssports.com/?login=confirmed&tid=1786667226")
    ).toBe(false);
    expect(looksLikeCbsDraftRoom("https://allfam.football.cbssports.com/draft/live/room2")).toBe(true);
    expect(looksLikeCbsDraftRoom("https://mockdraft-1.football.cbssports.com/mockdraft/standard")).toBe(true);
    expect(isCbsMockDraftRoom("https://mockdraft-1.football.cbssports.com/mockdraft/standard")).toBe(true);
    expect(isCbsMockDraftRoom("https://allfam.football.cbssports.com/draft/live/room2")).toBe(false);
    expect(isCbsMockDraftRoom(DEFAULT_CBS_MOCK_DRAFT_URL)).toBe(false);
    expect(looksLikeCbsMockDraftLobby(DEFAULT_CBS_MOCK_DRAFT_URL)).toBe(true);
    expect(looksLikeCbsDraftRoom(DEFAULT_CBS_MOCK_DRAFT_URL)).toBe(false);
    expect(isAllInTheFamilyHost("https://allfam.football.cbssports.com/draft/live/room2")).toBe(true);
    expect(isAllInTheFamilyHost("https://mockdraft-1.football.cbssports.com/mockdraft/standard")).toBe(
      false
    );
    expect(looksLikeCbsDraftRoom("https://allfam.football.cbssports.com/draft-central/draft-research")).toBe(
      false
    );
    expect(
      looksLikeCbsDraftRoom("https://mockdraft35-2860135.football.cbssports.com/draft/live/room2")
    ).toBe(true);
    expect(isCbsMockDraftRoom("https://mockdraft35-2860135.football.cbssports.com/draft/live/room2")).toBe(
      true
    );
    expect(isAllInTheFamilyHost("https://mockdraft35-2860135.football.cbssports.com/draft/live/room2")).toBe(
      false
    );
  });

  it("prefers a draft-room popup URL over league feed", () => {
    expect(
      pickDraftRoomUrl([
        "https://allfam.football.cbssports.com/?login=confirmed&tid=1",
        "https://allfam.football.cbssports.com/draft/live/room2"
      ])
    ).toBe("https://allfam.football.cbssports.com/draft/live/room2");
    expect(pickDraftRoomUrl(["https://allfam.football.cbssports.com/"])).toBeNull();
    expect(
      pickDraftRoomUrl([
        DEFAULT_CBS_MOCK_DRAFT_URL,
        "https://mockdraft-1.football.cbssports.com/mockdraft/standard"
      ])
    ).toBe("https://mockdraft-1.football.cbssports.com/mockdraft/standard");
    expect(
      pickDraftRoomUrl(
        [
          "https://allfam.football.cbssports.com/draft-central/draft-research",
          "https://allfam.football.cbssports.com/draft/live/room2"
        ],
        "allfam.football.cbssports.com/draft/live/room2"
      )
    ).toBe("https://allfam.football.cbssports.com/draft/live/room2");
  });

  it("skips ad/tracker/blank frames and keeps the CBS draft room", () => {
    expect(shouldInspectFrame("https://allfam.football.cbssports.com/draft/live/room2", "")).toBe(true);
    expect(shouldInspectFrame("about:blank", "_yuiResizeMonitor")).toBe(false);
    expect(shouldInspectFrame("https://platform.twitter.com/widgets/widget_iframe.html", "")).toBe(false);
    expect(shouldInspectFrame("https://cm.g.doubleclick.net/partnerpixels", "")).toBe(false);
  });
});

describe("CBS parse helpers", () => {
  it("parses overall pick and clock text", () => {
    expect(parseOverallPick("Pick 21")).toBe(21);
    expect(parseOverallPick("Round 1, Pick 2 (Overall #2)")).toBe(2);
    expect(parseOverallPickLenient("Round 4")).toBeNull();
    expect(
      parseTeamOnClock("Round 1, Pick 2 (Overall #2) On the Clock: pickens fan On Deck: ilite4u2")
    ).toBe("pickens fan");
    expect(parseClockSeconds("00:47")).toBe(47);
    expect(parseClockSeconds("1:05")).toBe(65);
    expect(parseClockSeconds("25:22:34:52")).toBe(25 * 3600 + 22 * 60 + 34);
    expect(parseClockSeconds("1:01:45:30")).toBe(1 * 86400 + 1 * 3600 + 45 * 60 + 30);
    expect(formatClockDuration(1 * 86400 + 1 * 3600 + 45 * 60 + 30)).toBe("1 day 1 hour 45 minutes");
    expect(formatClockSeconds(25 * 3600 + 22 * 60 + 23)).toBe("25:22:23");
    expect(formatOnClockStatus("Waiting for Start", false)).toBe("draft has not started");
    expect(formatOnClockStatus("Pickens My Jeanty", true)).toBe("Pickens My Jeanty is the user");
    expect(parseOverallPickLenient("Waiting for Start")).toBeNull();
    expect(interpretYouAreUp("YOU ARE UP IN 2 PICKS")).toBe(false);
    expect(interpretYouAreUp("YOU ARE UP")).toBe(true);
    expect(interpretYouAreUp("YOU ARE ON THE CLOCK")).toBe(true);
    expect(interpretYouAreUp("Waiting for Start")).toBe(false);
    expect(classifyMockRoomPhase({ statusText: "Completed", youAreUpText: "" })).toBe("completed");
    expect(
      classifyMockRoomPhase({ statusText: "Round 7, Pick 5 (Overall #65)", youAreUpText: "YOU ARE UP IN 15 PICKS" })
    ).toBe("waiting_turn");
    expect(
      classifyMockRoomPhase({ statusText: "Round 7, Pick 5 (Overall #65)", youAreUpText: "YOU ARE UP" })
    ).toBe("on_clock");
    expect(
      classifyMockRoomPhase({
        statusText: "Round 3, Pick 1 (Overall #29)",
        youAreUpText: "",
        haystack: "On the Clock: pickens fan YOU ARE ON THE CLOCK"
      })
    ).toBe("on_clock");
    expect(playerPopupLooksOpen("")).toBe(false);
    expect(playerPopupLooksOpen("YOU ARE ON THE CLOCK")).toBe(false);
    expect(playerPopupLooksOpen("Ja'Marr Chase WR Draft")).toBe(true);
    expect(looksLikeDraftActionLabel("Draft")).toBe(true);
    expect(looksLikeDraftActionLabel("DRAFT HELP")).toBe(false);
    expect(looksLikeDraftActionLabel("DRAFT RESULTS")).toBe(false);
    expect(looksLikeDraftActionLabel("TURN ON AUTOPILOT")).toBe(false);
    expect(toCbsLastFirst("Breece Hall")).toBe("Hall, Breece");
    expect(toCbsLastFirst("Luther Burden III")).toBe("Burden III, Luther");
    expect(toCbsLastFirst("Marvin Harrison Jr.")).toBe("Harrison Jr., Marvin");
    expect(playerNamesEquivalent("Zay Flowers", "Flowers, Zay (WR BAL)")).toBe(true);
    expect(playerNamesEquivalent("Bucky Irving", "*Irving, Bucky (RB TB)")).toBe(true);
    expect(playerNamesEquivalent("Breece Hall", "Waddle, Jaylen")).toBe(false);
  });

  it("reads CBS team-list labels and pick-interval copy without using config order", () => {
    expect(parseTeamLabels([
      { text: "YOU ARE UP IN 2 PICKS" },
      { alt: "Hairy Butterscotch", title: "Hairy Butterscotch" },
      { title: "Gibbs me a win" },
      { alt: "Y" },
      { title: "Pickens My Jeanty (Jack Oien)" }
    ])).toEqual(["Hairy Butterscotch", "Gibbs me a win", "Pickens My Jeanty"]);
    expect(ownerFromDraftOrder(["A", "B", "C", "D"], 5, 4)).toBe("D");
    expect(parsePickIntervalSeconds("Time Between Picks: 1:30")).toBe(90);
    expect(parsePickIntervalSeconds("90 seconds between picks")).toBe(90);
    expect(extractPickIntervalRaw("Draft Room Time Between Picks: 1:30 TURN ON AUTOPILOT")).toMatch(/Time Between Picks: 1:30/i);
    expect(formatPickInterval(90)).toBe("1 minute 30 seconds between picks");
    expect(mergeDraftOrder(
      ["Yo Mama", "Clyde", "Pickens My Jeanty"],
      ["Pickens My Jeanty", "Gronk if youre horny", "Dezzie Does Dallas"]
    )).toEqual(["Yo Mama", "Clyde", "Pickens My Jeanty", "Gronk if youre horny", "Dezzie Does Dallas"]);
  });

  it("reads public mock lobby copy for scoring and team size without inventing selectors", () => {
    expect(parseScoringFormat("PPR - Standard Roster 4 of 10")).toEqual({
      format: "PPR",
      raw: "PPR - Standard Roster"
    });
    expect(parseScoringFormat("PPR - Flex Roster")).toMatchObject({ format: "PPR" });
    expect(parseScoringFormat("Standard Roster 1 of 12")).toEqual({
      format: "NON_PPR",
      raw: "Standard Roster"
    });
    expect(parseScoringFormat("Half PPR 10 Team")).toMatchObject({ format: "HALF_PPR" });
    expect(parseListedTeamCount("PPR - Standard Roster 4 of 10")).toBe(10);
    expect(parseListedTeamCount("12 Team PPR")).toBe(12);
    const lobby = "PPR - Flex Roster 6 of 12 Join Now Standard Roster 1 of 10 Join Now";
    expect(parseScoringFormat(lobby)).toBeNull();
    expect(parseListedTeamCount(lobby)).toBeNull();
    const league = loadLeagueConfig("config/league.mock.confirm.json");
    const ten = applyMockRoomFacts(league, {
      draftOrder: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"],
      haystack: "Standard Roster 10 Team"
    });
    expect(ten.league.teamCount).toBe(10);
    expect(ten.league.scoringFormat).toBe("NON_PPR");
    expect(ten.league.keepers).toEqual([]);
    expect(ten.conflicts.join(" ")).toMatch(/10 teams/);
    expect(ten.conflicts.join(" ")).toMatch(/NON_PPR/);
  });
});

describe("config conflicts", () => {
  it("surfaces live contradictions instead of silently updating league config", () => {
    const league = loadLeagueConfig("config/league.current.json");
    const conflicts = detectConfigConflicts(
      {
        teamCount: 12,
        draftType: "linear",
        userKeepers: [{ name: "Someone Else", position: "RB" }]
      },
      league
    );
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts.join(" ")).toMatch(/team count/);
    expect(conflicts.join(" ")).toMatch(/draft type/);
    expect(conflicts.join(" ")).toMatch(/keepers/);
  });
});

describe("draft result resync", () => {
  it("adopts an unambiguous CBS pick that local state is missing", () => {
    const players = loadSportslineWorkbook("data/reference/cheatsheet_cbsppr12.xlsx");
    const result = resyncFromDraftResults(
      [],
      [{ overallPick: 1, fantasyTeam: "Hairy Butterscotch", playerName: "Jahmyr Gibbs", position: "RB" }],
      players,
      "test"
    );
    expect(result.needsOperatorReview).toBe(false);
    expect(result.events[0]?.playerId).toBe("jahmyr gibbs::RB");
  });

  it("matches CBS last-first result cells so drafted players leave the pool", () => {
    const players = loadSportslineWorkbook("data/reference/cheatsheet_cbsppr12.xlsx");
    const result = resyncFromDraftResults(
      [],
      [{ overallPick: 1, fantasyTeam: "Unitas", playerName: "Robinson, Bijan (RB ATL)" }],
      players,
      "test"
    );
    expect(result.needsOperatorReview).toBe(false);
    expect(result.events[0]?.playerId).toBe("bijan robinson::RB");
    expect(result.events[0]?.playerName).toBe("Bijan Robinson");
  });

  it("does not silently overwrite a local/CBS identity disagreement", () => {
    const players = loadSportslineWorkbook("data/reference/cheatsheet_cbsppr12.xlsx");
    const result = resyncFromDraftResults(
      [
        {
          overallPick: 1,
          fantasyTeam: "Hairy Butterscotch",
          playerId: "bijan robinson::RB",
          playerName: "Bijan Robinson",
          position: "RB",
          observedAt: "local"
        }
      ],
      [{ overallPick: 1, fantasyTeam: "Hairy Butterscotch", playerName: "Jahmyr Gibbs", position: "RB" }],
      players,
      "test"
    );
    expect(result.needsOperatorReview).toBe(true);
    expect(result.events[0]?.playerId).toBe("bijan robinson::RB");
  });
});

describe("selector config", () => {
  it("keeps the example file unconfigured so live clicking cannot start", () => {
    const config = loadSelectorConfig("config/selectors.example.json");
    expect(config.status.startsWith("UNCONFIGURED")).toBe(true);
    expect(config.kind).toBe("live");
    expect(requiredReadSelectors(config).length).toBeGreaterThan(0);
  });

  it("falls back to committed locators when SELECTOR_CONFIG points at a missing file", () => {
    const previous = process.env.SELECTOR_CONFIG;
    process.env.SELECTOR_CONFIG = "config/missing-selectors-for-test.json";
    try {
      const resolved = resolveSelectorConfigPath();
      expect(resolved).toMatch(/config\/selectors\.(local|live)\.json$/);
      expect(resolved).not.toBe("config/missing-selectors-for-test.json");
    } finally {
      if (previous == null) delete process.env.SELECTOR_CONFIG;
      else process.env.SELECTOR_CONFIG = previous;
    }
  });

  it("does not use mock selector configs for live CBS commands", () => {
    expect(isMockSelectorConfig(loadSelectorConfig("config/selectors.mock.json"))).toBe(true);
    const previous = process.env.SELECTOR_CONFIG;
    process.env.SELECTOR_CONFIG = "config/selectors.mock.json";
    try {
      expect(resolveSelectorConfigPath()).toBe("config/selectors.live.json");
    } finally {
      if (previous == null) delete process.env.SELECTOR_CONFIG;
      else process.env.SELECTOR_CONFIG = previous;
    }
  });

  it("loads live room2 locators captured from the real draft room", () => {
    const config = loadSelectorConfig("config/selectors.live.json");
    expect(config.status.startsWith("UNCONFIGURED")).toBe(false);
    expect(config.draftRoomUrlPattern).toContain("draft/live/room2");
    expect(requiredReadSelectors(config)).toEqual([]);
    expect(config.selectors.draftAction).toBeNull();
    expect(config.selectors.countdownClock).toContain("DraftRoom.views.timer");
  });
});

describe("CBS Chrome profile", () => {
  it("keeps mock diagnose off the live companion profile by default", () => {
    const previousLive = process.env.CBS_BROWSER_PROFILE_DIR;
    const previousMock = process.env.CBS_MOCK_BROWSER_PROFILE_DIR;
    delete process.env.CBS_BROWSER_PROFILE_DIR;
    delete process.env.CBS_MOCK_BROWSER_PROFILE_DIR;
    try {
      expect(resolveCbsBrowserProfileDir("live")).toBe(".local/cbs-browser-profile");
      expect(resolveCbsBrowserProfileDir("mock")).toBe(".local/cbs-mock-browser-profile");
    } finally {
      if (previousLive == null) delete process.env.CBS_BROWSER_PROFILE_DIR;
      else process.env.CBS_BROWSER_PROFILE_DIR = previousLive;
      if (previousMock == null) delete process.env.CBS_MOCK_BROWSER_PROFILE_DIR;
      else process.env.CBS_MOCK_BROWSER_PROFILE_DIR = previousMock;
    }
  });

  it("explains a locked profile instead of a raw Playwright launch error", () => {
    const explained = explainCbsProfileLaunchError(
      ".local/cbs-browser-profile",
      new Error("browserType.launchPersistentContext: user data directory is already in use")
    );
    expect(explained.message).toContain("already in use");
    expect(explained.message).toContain(".local/cbs-browser-profile");
    expect(explained.message).toContain("companion");
  });
});

describe("mock start URL", () => {
  it("remembers a live mock room URL and refuses All in the Family", () => {
    const dirty =
      "https://mockdraft35-2860135.football.cbssports.com/draft/live/room2?login=confirmed&tid=1788821937";
    expect(canonicalizeMockDraftUrl(dirty)).toBe(
      "https://mockdraft35-2860135.football.cbssports.com/draft/live/room2"
    );
    expect(() =>
      canonicalizeMockDraftUrl("https://allfam.football.cbssports.com/draft/live/room2")
    ).toThrow(/non-mock/);

    const file = path.join(os.tmpdir(), `mock-start-url-${Date.now()}.txt`);
    const previous = process.env.CBS_MOCK_DRAFT_URL;
    delete process.env.CBS_MOCK_DRAFT_URL;
    try {
      persistMockDraftStartUrl(dirty, file);
      expect(resolveMockDraftStartUrl(file)).toBe(
        "https://mockdraft35-2860135.football.cbssports.com/draft/live/room2"
      );
    } finally {
      fs.rmSync(file, { force: true });
      if (previous == null) delete process.env.CBS_MOCK_DRAFT_URL;
      else process.env.CBS_MOCK_DRAFT_URL = previous;
    }
  });
});
