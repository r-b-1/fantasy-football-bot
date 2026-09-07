import type { Page } from "playwright";
import type { DraftState, LeagueConfig, LivePlayer, SportslinePlayer } from "../domain/types.js";
import { requirePlayer } from "../engine/identity.js";
import { nextUserOverallPick, recentPositionCounts } from "../engine/state.js";
import { assertAllowedCbsUrl, assertAllowedFixtureUrl, hostnameOf, looksLikeCbsDraftRoom } from "./allowlist.js";
import { selectorsUnconfigured } from "./errors.js";
import { isVisible, locatorFromConfig, readAllInnerTexts, readVisibleText } from "./locators.js";
import { interpretYouAreUp, parseClockSecondsLenient, parseOverallPickLenient } from "./parse.js";
import {
  extractPickIntervalRaw,
  isWaitingToStart,
  mergeDraftOrder,
  parsePickIntervalSeconds,
  parseTeamLabels,
  type TeamListNode
} from "./roomFacts.js";
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
  private collectedDraftOrder: string[] = [];
  private teamListWalked = false;

  constructor(
    private readonly page: Page,
    private readonly selectors: SelectorConfig,
    private league: LeagueConfig
  ) {
    this.page.setDefaultTimeout(8000);
  }

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
    if (!looksLikeCbsDraftRoom(url)) {
      throw new Error(`Unexpected CBS URL: ${url}`);
    }
    if (hostnameOf(url).includes("mockdraft")) return;
    if (!url.includes(this.selectors.draftRoomUrlPattern)) {
      throw new Error(`Unexpected CBS URL: ${url}`);
    }
  }

  updateLeague(league: LeagueConfig): void {
    this.league = league;
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
    let clockRaw: string | null = null;
    let clockSecondsRemaining: number | null = null;
    if (this.selectors.selectors.countdownClock) {
      clockRaw = await readVisibleText(
        this.page,
        this.selectors.selectors.countdownClock,
        "countdownClock"
      );
      clockSecondsRemaining = parseClockSecondsLenient(clockRaw);
    }

    let draftOrder: string[] = [];
    try {
      draftOrder = await this.readDraftOrder(youAreUpRaw);
    } catch {
      draftOrder = [];
    }
    let pickClock = { seconds: null as number | null, raw: null as string | null };
    try {
      pickClock = await this.readPickInterval();
    } catch {
      pickClock = { seconds: null, raw: null };
    }
    const results = await this.readDraftResults();
    const roster = await this.readUserRosterNames();
    const resync = resyncFromDraftResults([], results, players);
    const currentOverallPick = parseOverallPickLenient(currentPickRaw);
    const waitingToStart = isWaitingToStart(teamOnClock, currentOverallPick);
    const isUserTurn = this.league.inferUserTeamFromYouAreUp
      ? youAreUp && !waitingToStart
      : youAreUp && teamOnClock === this.league.userTeamName;
    const conflicts = [...resync.conflicts];
    if (this.selectors.kind === "live" && draftOrder.length === 0) {
      conflicts.push("CBS team list is visible, but team names were not in that widget's labels.");
    } else if (
      this.selectors.kind === "live" &&
      draftOrder.length > 0 &&
      draftOrder.length < this.league.teamCount
    ) {
      conflicts.push(
        `CBS team list currently shows ${draftOrder.length} of ${this.league.teamCount} teams after clicking the right arrow in that row.`
      );
    }
    if (
      youAreUp &&
      teamOnClock !== this.league.userTeamName &&
      !this.league.inferUserTeamFromYouAreUp
    ) {
      conflicts.push(
        `CBS "you are up" indicator is visible, but team on clock is "${teamOnClock}" rather than configured "${this.league.userTeamName}".`
      );
    }

    return {
      url: this.page.url(),
      capturedAt: new Date().toISOString(),
      control: {
        currentOverallPick,
        teamOnClock,
        isUserTurn,
        youAreUp,
        waitingToStart,
        clockSecondsRemaining,
        clockRaw,
        secondsPerPick: pickClock.seconds,
        pickClockRaw: pickClock.raw,
        draftOrder
      },
      results,
      roster,
      leagueFacts: {},
      conflicts
    };
  }

  async readDraftState(
    players: SportslinePlayer[],
    options: { recentPickWindow?: number } = {}
  ): Promise<DraftState> {
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
      recentPositionCounts: recentPositionCounts(resync.events, options.recentPickWindow ?? 8),
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
    if (count === 0) return [];
    const results: LiveDraftResult[] = [];
    for (let i = 0; i < count; i += 1) {
      const row = rowLocator.nth(i);
      const pickText = (await row.locator(pickWithin).innerText({ timeout: 500 }).catch(() => "")).trim();
      const fantasyTeam = (await row.locator(teamWithin).innerText({ timeout: 500 }).catch(() => "")).trim();
      const playerName = (await row.locator(playerWithin).innerText({ timeout: 500 }).catch(() => "")).trim();
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

  private async readDraftOrder(youAreUpRaw: string): Promise<string[]> {
    const visible = await this.readVisibleDraftOrder(youAreUpRaw);
    this.collectedDraftOrder = mergeDraftOrder(this.collectedDraftOrder, visible);
    if (this.collectedDraftOrder.length >= this.league.teamCount) return this.collectedDraftOrder;
    const selector = this.selectors.selectors.youAreUpIndicator;
    if (!selector || this.teamListWalked || visible.length < 2) return this.collectedDraftOrder;
    this.teamListWalked = true;
    const advanced = await this.advanceTeamList(selector);
    this.collectedDraftOrder = mergeDraftOrder(this.collectedDraftOrder, advanced);
    return this.collectedDraftOrder;
  }

  private async readVisibleDraftOrder(youAreUpRaw: string): Promise<string[]> {
    const selector = this.selectors.selectors.youAreUpIndicator;
    const fromBanner = parseTeamLabels([{ text: youAreUpRaw }]);
    if (!selector) return fromBanner;
    const dumped = (await this.page.evaluate(
      `(() => {
        const root = document.querySelector(${JSON.stringify(selector)});
        if (!root) return [];
        const nodes = Array.from(root.querySelectorAll("img, td, th, a, li, button, [title], [aria-label]")).map((el) => ({
          alt: el.getAttribute("alt"),
          title:
            el.getAttribute("title") ||
            el.getAttribute("data-original-title") ||
            el.closest("[title]")?.getAttribute("title") ||
            null,
          ariaLabel: el.getAttribute("aria-label"),
          text: (el.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 120)
        }));
        const html = root.innerHTML || "";
        for (const match of html.matchAll(/(?:title|alt|aria-label)="([^"]{2,80})"/g)) {
          nodes.push({ title: match[1] });
        }
        return nodes;
      })()`
    )) as TeamListNode[];
    const fromWidget = parseTeamLabels(dumped);
    if (fromWidget.length >= 2) return fromWidget;
    const images = locatorFromConfig(this.page, selector, "youAreUpIndicator").getByRole("img");
    const count = await images.count().catch(() => 0);
    const imageNodes: TeamListNode[] = [];
    for (let i = 0; i < count; i += 1) {
      const img = images.nth(i);
      imageNodes.push({
        alt: await img.getAttribute("alt"),
        title: await img.getAttribute("title"),
        ariaLabel: await img.getAttribute("aria-label")
      });
    }
    const fromImages = parseTeamLabels(imageNodes);
    return fromImages.length >= 2 ? fromImages : fromBanner;
  }

  private async advanceTeamList(selector: string): Promise<string[]> {
    let order = [...this.collectedDraftOrder];
    let nextClicks = 0;
    const limit = this.league.teamCount;
    while (order.length < limit && nextClicks < limit) {
      const before = order.length;
      const clicked = await this.clickTeamListArrow(selector, "next");
      if (!clicked) break;
      nextClicks += 1;
      const visible = await this.waitForTeamListChange(order);
      order = mergeDraftOrder(order, visible);
      if (order.length === before) break;
    }
    for (let i = 0; i < nextClicks; i += 1) {
      const restored = await this.clickTeamListArrow(selector, "prev", { allowDisabled: true });
      if (!restored) break;
    }
    return order;
  }

  private async waitForTeamListChange(previous: string[]): Promise<string[]> {
    const before = previous.map((name) => name.toLowerCase()).join("|");
    const started = Date.now();
    let visible = previous;
    while (Date.now() - started < 1500) {
      visible = await this.readVisibleDraftOrder("");
      const merged = mergeDraftOrder(previous, visible);
      if (merged.length > previous.length) return visible;
      if (visible.map((name) => name.toLowerCase()).join("|") !== before) return visible;
      await this.page.waitForTimeout(100);
    }
    return visible;
  }

  private async clickTeamListArrow(
    selector: string,
    direction: "next" | "prev",
    options: { allowDisabled?: boolean } = {}
  ): Promise<boolean> {
    const root = locatorFromConfig(this.page, selector, "youAreUpIndicator");
    const glyphs = direction === "next" ? [">", "›", "»", "→"] : ["<", "‹", "«", "←"];
    const named = direction === "next" ? /next|right|forward/i : /prev|previous|left|back/i;
    // Live room2 dump 2026-09-07: pager is icon-chevron-* inside the teamlist.
    // icon-arrow-right sits under a team logo and is not the pager.
    const chevron = direction === "next"
      ? "a.icon-chevron-right, button.icon-chevron-right, span.icon-chevron-right"
      : "a.icon-chevron-left, button.icon-chevron-left, span.icon-chevron-left";
    const candidates = [
      ...glyphs.map((glyph) => root.getByText(glyph, { exact: true })),
      root.locator(chevron),
      root.getByRole("button", { name: named }),
      root.getByRole("link", { name: named }),
      root.getByRole("img", { name: named }),
      root.getByLabel(named),
      root.getByTitle(named)
    ];
    for (const locator of candidates) {
      const control = locator.first();
      const visible = await control.isVisible().catch(() => false);
      if (!visible) continue;
      const className = (await control.getAttribute("class").catch(() => "")) ?? "";
      if (!options.allowDisabled) {
        const enabled = await control.isEnabled().catch(() => true);
        if (!enabled || /\bicon-grey-2\b/.test(className)) return false;
      }
      await control.click({ timeout: 2000, noWaitAfter: true });
      return true;
    }
    const clicked = (await this.page.evaluate(
      `(() => {
        const root = document.querySelector(${JSON.stringify(selector)});
        if (!root) return false;
        const allowDisabled = ${options.allowDisabled ? "true" : "false"};
        const chevron = root.querySelector(${JSON.stringify(chevron)});
        const glyphs = ${direction === "next" ? '["\\u003e","\\u203a","\\u00bb","\\u2192"]' : '["\\u003c","\\u2039","\\u00ab","\\u2190"]'};
        const named = ${direction === "next" ? "/next|right|forward/i" : "/prev|previous|left|back/i"};
        const match = chevron || Array.from(root.querySelectorAll("a, button, img, td, span, div")).find((el) => {
          if (/\\bicon-arrow-right\\b/.test(el.className || "")) return false;
          const bits = [
            (el.innerText || "").trim(),
            (el.getAttribute("alt") || "").trim(),
            (el.getAttribute("title") || "").trim(),
            (el.getAttribute("aria-label") || "").trim()
          ];
          return bits.some((bit) => glyphs.includes(bit) || (bit.length < 40 && named.test(bit)));
        });
        if (!match) return false;
        if (!allowDisabled && (match.disabled || match.getAttribute("aria-disabled") === "true" || /\\bicon-grey-2\\b/.test(match.className || ""))) {
          return false;
        }
        match.click();
        return true;
      })()`
    )) as boolean;
    return Boolean(clicked);
  }

  private async readPickInterval(): Promise<{ seconds: number | null; raw: string | null }> {
    const haystack = (await this.page.evaluate(
      `(() => (document.body ? document.body.textContent || "" : "").replace(/\\s+/g, " "))()`
    )) as string;
    const raw = extractPickIntervalRaw(haystack);
    return { seconds: raw ? parsePickIntervalSeconds(raw) : null, raw };
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
