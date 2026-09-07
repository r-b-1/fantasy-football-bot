import { describe, expect, it } from "vitest";
import {
  DEFAULT_CBS_MOCK_DRAFT_URL,
  isAllInTheFamilyHost,
  isAllowedCbsUrl,
  isAllowedFixtureUrl,
  leagueOrigin,
  leagueStartUrl,
  looksLikeCbsDraftRoom,
  looksLikeCbsMockDraftLobby,
  pickDraftRoomUrl
} from "../src/cbs/allowlist.js";
import { detectConfigConflicts } from "../src/cbs/conflicts.js";
import { shouldInspectFrame } from "../src/cbs/inspect.js";
import { parseClockSeconds, parseOverallPick, parseOverallPickLenient, interpretYouAreUp, formatClockSeconds, formatClockDuration, formatOnClockStatus } from "../src/cbs/parse.js";
import { extractPickIntervalRaw, formatPickInterval, mergeDraftOrder, ownerFromDraftOrder, parsePickIntervalSeconds, parseTeamLabels } from "../src/cbs/roomFacts.js";
import { resyncFromDraftResults } from "../src/cbs/resync.js";
import { loadLeagueConfig } from "../src/config/load.js";
import { loadSportslineWorkbook } from "../src/data/sportsline.js";
import { loadSelectorConfig, requiredReadSelectors, resolveSelectorConfigPath } from "../src/cbs/selectors.js";

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
    expect(looksLikeCbsMockDraftLobby(DEFAULT_CBS_MOCK_DRAFT_URL)).toBe(true);
    expect(looksLikeCbsDraftRoom(DEFAULT_CBS_MOCK_DRAFT_URL)).toBe(false);
    expect(isAllInTheFamilyHost("https://allfam.football.cbssports.com/draft/live/room2")).toBe(true);
    expect(isAllInTheFamilyHost("https://mockdraft-1.football.cbssports.com/mockdraft/standard")).toBe(
      false
    );
    expect(looksLikeCbsDraftRoom("https://allfam.football.cbssports.com/draft-central/draft-research")).toBe(
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
    expect(interpretYouAreUp("Waiting for Start")).toBe(false);
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

  it("loads live room2 locators captured from the real draft room", () => {
    const config = loadSelectorConfig("config/selectors.live.json");
    expect(config.status.startsWith("UNCONFIGURED")).toBe(false);
    expect(config.draftRoomUrlPattern).toContain("draft/live/room2");
    expect(requiredReadSelectors(config)).toEqual([]);
    expect(config.selectors.draftAction).toBeNull();
    expect(config.selectors.countdownClock).toContain("DraftRoom.views.timer");
  });
});
