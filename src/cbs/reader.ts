import type { Page } from "playwright";
import type { DraftState, LeagueConfig, LivePlayer, SportslinePlayer } from "../domain/types.js";
import { requirePlayer } from "../engine/identity.js";
import { nextUserOverallPick } from "../engine/state.js";
import { assertAllowedCbsUrl, assertAllowedFixtureUrl } from "./allowlist.js";
import { selectorsUnconfigured } from "./errors.js";
import { isVisible, readAllInnerTexts, readVisibleText } from "./locators.js";
import { interpretYouAreUp, parseClockSeconds, parseOverallPickLenient } from "./parse.js";
import { resyncFromDraftResults } from "./resync.js";
import {
  assertSelectorsConfigured,
  requiredReadSelectors,
  type SelectorConfig
} from "./selectors.js";
import type { LiveDraftResult, LiveDraftSnapshot } from "./types.js";

/**
 * Read-only CBS adapter. Selectors must come from Playwright MCP/codegen against
 * the real logged-in draft room. This class never invents locators.
 */
export class CBSReader {
  constructor(
    private readonly page: Page,
    private readonly selectors: SelectorConfig,
    private readonly league: LeagueConfig
  ) {}

  async assertDraftRoom(): Promise<void> {
    const url = this.page.url();
    if (this.selectors.kind === "fixture") {
      assertAllowedFixtureUrl(url);
      return;
    }
    if (url.includes("fixture-draft-room")) {
      throw new Error(`Live CBS reader refused fixture URL: ${url}`);
    }
    assertAllowedCbsUrl(url);
    if (!url.includes(this.selectors.draftRoomUrlPattern)) {
      throw new Error(`Unexpected CBS URL: ${url}`);
    }
  }

  async readLiveSnapshot(players: SportslinePlayer[]): Promise<LiveDraftSnapshot> {
    await this.assertDraftRoom();
    this.assertReady();

    const currentPickRaw = await readVisibleText(
      this.page,
      this.selectors.selectors.currentPick,
      "currentPick"
    );
    const teamOnClockRaw = await readVisibleText(
      this.page,
      this.selectors.selectors.teamOnClock,
      "teamOnClock"
    );
    const teamOnClock = teamOnClockRaw.trim() || null;
    const youAreUpVisible = this.selectors.selectors.youAreUpIndicator
      ? await isVisible(this.page, this.selectors.selectors.youAreUpIndicator, "youAreUpIndicator")
      : false;
    const youAreUpRaw =
      youAreUpVisible && this.selectors.selectors.youAreUpIndicator
        ? await readVisibleText(
            this.page,
            this.selectors.selectors.youAreUpIndicator,
            "youAreUpIndicator"
          )
        : "";
    const youAreUp = interpretYouAreUp(youAreUpRaw);
    let clockSecondsRemaining: number | null = null;
    if (this.selectors.selectors.countdownClock) {
      const clockRaw = await readVisibleText(
        this.page,
        this.selectors.selectors.countdownClock,
        "countdownClock"
      );
      clockSecondsRemaining = parseClockSeconds(clockRaw);
    }

    const results = await this.readDraftResults();
    const roster = await this.readUserRosterNames();
    const resync = resyncFromDraftResults([], results, players);
    const isUserTurn = youAreUp && teamOnClock === this.league.userTeamName;
    const conflicts = [...resync.conflicts];
    if (youAreUp && teamOnClock !== this.league.userTeamName) {
      conflicts.push(
        `CBS "you are up" indicator is visible, but team on clock is "${teamOnClock}" rather than configured "${this.league.userTeamName}".`
      );
    }

    return {
      url: this.page.url(),
      capturedAt: new Date().toISOString(),
      control: {
        currentOverallPick: parseOverallPickLenient(currentPickRaw),
        teamOnClock,
        isUserTurn,
        clockSecondsRemaining
      },
      results,
      roster,
      leagueFacts: {},
      conflicts
    };
  }

  async readDraftState(players: SportslinePlayer[]): Promise<DraftState> {
    const snapshot = await this.readLiveSnapshot(players);
    const resync = resyncFromDraftResults([], snapshot.results, players, snapshot.capturedAt);
    const keeperIds = this.league.keepers.map(
      (keeper) => requirePlayer(players, keeper.name, keeper.position).id
    );
    const takenIds = new Set([...keeperIds, ...resync.events.map((event) => event.playerId)]);
    const userDrafted = resync.events.filter(
      (event) => event.fantasyTeam === this.league.userTeamName
    );

    return {
      currentOverallPick: snapshot.control.currentOverallPick ?? 0,
      nextUserOverallPick: nextUserOverallPick(
        snapshot.control.currentOverallPick ?? 0,
        this.league.knownOverallPicks
      ),
      teamOnClock: snapshot.control.teamOnClock,
      isUserTurn: snapshot.control.isUserTurn,
      clockSecondsRemaining: snapshot.control.clockSecondsRemaining,
      snapshotAt: snapshot.capturedAt,
      roster: {
        players: [
          ...this.league.keepers.map((keeper) => {
            const player = requirePlayer(players, keeper.name, keeper.position);
            return {
              playerId: player.id,
              name: player.name,
              position: player.position,
              byeWeek: player.byeWeek,
              source: "keeper" as const
            };
          }),
          ...userDrafted.map((event) => {
            const player = players.find((p) => p.id === event.playerId);
            return {
              playerId: event.playerId,
              name: event.playerName,
              position: event.position ?? player?.position ?? "WR",
              byeWeek: player?.byeWeek ?? null,
              source: "draft" as const
            };
          })
        ]
      },
      draftEvents: resync.events,
      availablePlayerIds: new Set(
        players.filter((player) => !takenIds.has(player.id)).map((player) => player.id)
      ),
      recentPositionCounts: {},
      warnings: snapshot.conflicts
    };
  }

  async readAvailablePlayers(): Promise<LivePlayer[]> {
    await this.assertDraftRoom();
    this.assertReady();
    throw new Error(
      "CBSReader.readAvailablePlayers still needs player-row locators captured from the live draft room. Do not implement with guessed selectors."
    );
  }

  async readDraftResults(): Promise<LiveDraftResult[]> {
    this.assertReady();
    const rows = this.selectors.selectors.draftResultRows;
    const pickWithin = this.selectors.selectors.draftResultPickWithinRow;
    const teamWithin = this.selectors.selectors.draftResultTeamWithinRow;
    const playerWithin = this.selectors.selectors.draftResultPlayerWithinRow;
    if (!rows || !pickWithin || !teamWithin || !playerWithin) {
      throw selectorsUnconfigured();
    }

    const rowLocator = this.page.locator(rows);
    const count = await rowLocator.count();
    const results: LiveDraftResult[] = [];
    for (let i = 0; i < count; i += 1) {
      const row = rowLocator.nth(i);
      const pickText = (await row.locator(pickWithin).innerText().catch(() => "")).trim();
      const fantasyTeam = (await row.locator(teamWithin).innerText().catch(() => "")).trim();
      const playerName = (await row.locator(playerWithin).innerText().catch(() => "")).trim();
      const overallPick = parseOverallPickLenient(pickText);
      if (overallPick == null || !fantasyTeam || !playerName) continue;
      if (/^pick$/i.test(pickText) || /^team$/i.test(fantasyTeam) || /^player$/i.test(playerName)) continue;
      results.push({ overallPick, fantasyTeam, playerName });
    }
    return results;
  }

  private assertReady(): void {
    assertSelectorsConfigured(this.selectors);
    if (requiredReadSelectors(this.selectors).length > 0) {
      throw selectorsUnconfigured();
    }
  }

  private async readUserRosterNames(): Promise<Array<{ name: string }>> {
    if (!this.selectors.selectors.userRosterRows) return [];
    const names = await readAllInnerTexts(
      this.page,
      this.selectors.selectors.userRosterRows,
      "userRosterRows"
    );
    return names.filter(Boolean).map((name) => ({ name }));
  }
}
