import { z } from "zod";
import { isAllowedCbsUrl, isAllowedFixtureUrl, leagueStartUrl, looksLikeCbsDraftRoom } from "../cbs/allowlist.js";
import { CbsError } from "../cbs/errors.js";
import { startFixtureServer, type FixtureServer } from "../cbs/fixtureServer.js";
import { CBSReader } from "../cbs/reader.js";
import {
  assertFixtureSelectorConfig,
  assertLiveSelectorConfig,
  loadSelectorConfig,
  requiredReadSelectors,
  resolveSelectorConfigPath,
  type SelectorConfig
} from "../cbs/selectors.js";
import {
  closeSession,
  openAllowlistedCbsPage,
  openCBSSession,
  openEphemeralBrowser,
  pickReadableDraftRoomPage,
  type CBSSession
} from "../cbs/session.js";
import type { LeagueConfig } from "../domain/types.js";
import { applyLiveTurnIdentity } from "../engine/state.js";
import { applyRoomSnapshot, clearDraftedPicks, roomIsWritable, type RoomKind, type RoomPublicStatus } from "./roomSync.js";
import type { SessionState } from "./session.js";

export const RoomConnectSchema = z.object({
  source: z.enum(["fixture", "live"]),
  headless: z.boolean().optional(),
  pauseOnUser: z.boolean().optional(),
  autoplay: z.boolean().optional(),
  intervalMs: z.number().int().min(50).max(10_000).optional(),
  untilPick: z.number().int().min(1).max(300).optional()
});

export type RoomConnectRequest = z.infer<typeof RoomConnectSchema>;

export function assertCompanionCanWatchLive(league: LeagueConfig, selectors: SelectorConfig): void {
  assertLiveSelectorConfig(selectors);
  if (requiredReadSelectors(selectors).length > 0) {
    throw new Error(
      "CBS read selectors are not configured. Run `npm run cbs:diagnose` in the logged-in draft room first. Do not guess selectors."
    );
  }
  if (league.cbsExecutionEnabled) {
    throw new Error("Companion room watching refuses a config with cbsExecutionEnabled=true.");
  }
  if (league.executionMode === "autopilot" || league.executionMode === "confirm") {
    throw new Error(`Companion room watching refuses executionMode=${league.executionMode}. Use recommend.`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CompanionRoomBridge {
  private kind: RoomKind = "manual";
  private status: RoomPublicStatus["status"] = "disconnected";
  private error: string | null = null;
  private url: string | null = null;
  private targetUrl: string | null = null;
  private running = false;
  private attachLock = false;
  private fixtureServer: FixtureServer | null = null;
  private browser: CBSSession | null = null;
  private reader: CBSReader | null = null;
  private intervalMs = 2000;
  private readonly fixtureHeadless: boolean;
  private readonly liveAllowed: boolean;

  constructor(
    private readonly getSession: () => SessionState,
    options: { liveAllowed: boolean; fixtureHeadless: boolean }
  ) {
    this.liveAllowed = options.liveAllowed;
    this.fixtureHeadless = options.fixtureHeadless;
  }

  publicStatus(): RoomPublicStatus {
    const overlay = this.getSession().room;
    return {
      kind: this.kind,
      status: this.status,
      writable: roomIsWritable(this.status),
      liveAllowed: this.liveAllowed,
      url: overlay?.url ?? this.url,
      targetUrl: this.targetUrl,
      clockSecondsRemaining: overlay?.clockSecondsRemaining ?? null,
      clockRaw: overlay?.clockRaw ?? null,
      waitingToStart: overlay?.waitingToStart ?? false,
      secondsPerPick: overlay?.secondsPerPick ?? null,
      pickClockRaw: overlay?.pickClockRaw ?? null,
      youAreUp: overlay?.youAreUp ?? false,
      conflicts: overlay?.conflicts ?? [],
      error: this.error,
      lastSnapshotAt: overlay?.capturedAt ?? null
    };
  }

  async connect(request: RoomConnectRequest): Promise<RoomPublicStatus> {
    if (this.attachLock || this.running || !roomIsWritable(this.status)) {
      throw new Error("A draft room is already attached. Disconnect first.");
    }
    this.attachLock = true;
    this.kind = request.source;
    this.status = "connecting";
    this.error = null;
    this.targetUrl = null;
    clearDraftedPicks(this.getSession());
    try {
      if (request.source === "fixture") {
        await this.connectFixture(request);
      } else {
        await this.connectLive();
      }
      return this.publicStatus();
    } catch (error) {
      await this.fail(error);
      throw error;
    }
  }

  async disconnect(): Promise<RoomPublicStatus> {
    this.running = false;
    await this.teardown();
    this.kind = "manual";
    this.status = "disconnected";
    this.error = null;
    this.url = null;
    this.targetUrl = null;
    this.attachLock = false;
    this.getSession().room = null;
    return this.publicStatus();
  }

  private async connectFixture(request: RoomConnectRequest): Promise<void> {
    const session = this.getSession();
    const selectors = loadSelectorConfig("config/selectors.fixture.json");
    assertFixtureSelectorConfig(selectors);
    const autoplay = request.autoplay ?? true;
    const pauseOnUser = request.pauseOnUser ?? true;
    const intervalMs = request.intervalMs ?? 400;
    this.fixtureServer = await startFixtureServer();
    this.browser = await openEphemeralBrowser(request.headless ?? this.fixtureHeadless);
    const query = new URLSearchParams({
      autoplay: autoplay ? "1" : "0",
      pauseOnUser: pauseOnUser ? "1" : "0",
      intervalMs: String(intervalMs)
    });
    if (request.untilPick != null) query.set("untilPick", String(request.untilPick));
    const target = `${this.fixtureServer.richUrl}?${query.toString()}`;
    this.targetUrl = this.fixtureServer.richUrl;
    await this.browser.page.goto(target, { waitUntil: "domcontentloaded" });
    if (isAllowedCbsUrl(this.browser.page.url())) {
      throw new Error("Safety abort: companion fixture room landed on CBS");
    }
    await this.browser.page.waitForFunction(
      () => typeof (window as unknown as { __teamFor?: unknown }).__teamFor === "function"
    );
    this.url = this.browser.page.url();
    if (!isAllowedFixtureUrl(this.url)) {
      throw new Error(`Fixture mode only allows the local fake draft room, not ${this.url}`);
    }
    this.reader = new CBSReader(this.browser.page, selectors, session.league);
    this.intervalMs = Math.max(150, intervalMs);
    this.status = "watching";
    this.running = true;
    await this.pollOnce();
    void this.loop();
  }

  private async connectLive(): Promise<void> {
    if (!this.liveAllowed) {
      throw new Error("Live CBS attach is disabled in this companion process.");
    }
    const session = this.getSession();
    const selectors = loadSelectorConfig(resolveSelectorConfigPath());
    assertCompanionCanWatchLive(session.league, selectors);
    const profileDir = process.env.CBS_BROWSER_PROFILE_DIR ?? ".local/cbs-browser-profile";
    this.targetUrl = leagueStartUrl(selectors.draftRoomUrlPattern);
    this.browser = await openCBSSession(profileDir);
    await openAllowlistedCbsPage(this.browser.page, selectors.draftRoomUrlPattern);
    if (isAllowedFixtureUrl(this.browser.page.url())) {
      throw new Error(`Live CBS attach refused a local fixture URL: ${this.browser.page.url()}`);
    }
    this.url = this.browser.page.url();
    this.intervalMs = 2000;
    this.status = "awaiting_draft_room";
    this.running = true;
    void this.loopLive(selectors);
  }

  private async loopLive(selectors: SelectorConfig): Promise<void> {
    while (this.running) {
      try {
        if (!this.reader) {
          const focused = await pickReadableDraftRoomPage(
            this.browser!,
            selectors,
            selectors.draftRoomUrlPattern
          );
          this.url = focused.page.url();
          if (isAllowedFixtureUrl(this.url)) {
            throw new Error(`Live CBS attach refused a local fixture URL: ${this.url}`);
          }
          if (looksLikeCbsDraftRoom(this.url)) {
            this.reader = new CBSReader(focused.page, selectors, this.getSession().league);
            this.status = "watching";
            await this.pollOnce();
          }
        } else {
          await this.pollOnce();
        }
      } catch (error) {
        if (!this.running) return;
        if (
          (error instanceof CbsError &&
            (error.kind === "selector_unresolved" || error.kind === "parse_failed")) ||
          (error instanceof Error && /timed out/i.test(error.message))
        ) {
          console.warn(`CBS room poll skipped: ${error instanceof Error ? error.message : error}`);
          if (error instanceof Error && /timed out/i.test(error.message)) {
            this.reader = null;
          }
          await sleep(this.intervalMs);
          continue;
        }
        await this.fail(error);
        return;
      }
      await sleep(this.intervalMs);
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
      await sleep(this.intervalMs);
      if (!this.running) return;
      try {
        await this.pollOnce();
      } catch (error) {
        if (!this.running) return;
        await this.fail(error);
        return;
      }
    }
  }

  private async pollOnce(): Promise<void> {
    if (!this.reader || !this.browser) return;
    const pageUrl = this.browser.page.url();
    if (this.kind === "fixture" && isAllowedCbsUrl(pageUrl)) {
      throw new Error("Safety abort: companion fixture reader saw a CBS URL");
    }
    if (this.kind === "live") {
      if (isAllowedFixtureUrl(pageUrl)) {
        throw new Error("Safety abort: companion live reader saw a fixture URL");
      }
      if (!isAllowedCbsUrl(pageUrl)) {
        throw new Error(`Live CBS attach left CBS: ${pageUrl}`);
      }
    }
    const session = this.getSession();
    const players = [...session.slById.values()];
    const snapshot = await Promise.race([
      this.reader.readLiveSnapshot(players),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("CBS snapshot timed out")), 15000);
      })
    ]);
    if (this.kind === "live") {
      const locked = applyLiveTurnIdentity(session.league, {
        youAreUp: snapshot.control.youAreUp,
        teamOnClock: snapshot.control.teamOnClock,
        currentOverallPick: snapshot.control.currentOverallPick
      });
      if (locked.userTeamName !== session.league.userTeamName || locked.draftSlot !== session.league.draftSlot) {
        session.league = locked;
        this.reader.updateLeague(locked);
      }
    }
    applyRoomSnapshot(session, snapshot, players);
  }

  private async fail(error: unknown): Promise<void> {
    this.running = false;
    this.error = error instanceof Error ? error.message : String(error);
    this.status = "error";
    this.attachLock = false;
    await this.teardown();
  }

  private async teardown(): Promise<void> {
    const browser = this.browser;
    const fixtureServer = this.fixtureServer;
    this.browser = null;
    this.fixtureServer = null;
    this.reader = null;
    if (browser) await closeSession(browser).catch(() => undefined);
    if (fixtureServer) await fixtureServer.close().catch(() => undefined);
  }
}
