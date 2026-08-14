import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadLeagueConfig, loadStrategyConfig } from "../src/config/load.js";
import { loadSportslineWorkbook } from "../src/data/sportsline.js";
import { FixtureExecutor, FixtureExecutorError } from "../src/cbs/fixtureExecutor.js";
import { startFixtureServer, type FixtureServer } from "../src/cbs/fixtureServer.js";
import { CBSReader } from "../src/cbs/reader.js";
import { loadSelectorConfig } from "../src/cbs/selectors.js";
import { closeSession, openEphemeralBrowser, type CBSSession } from "../src/cbs/session.js";
import { deterministicDecision } from "../src/engine/decision.js";
import { requirePlayer } from "../src/engine/identity.js";
import { generateShortlist } from "../src/engine/shortlist.js";
import { readEvents } from "../src/state/eventLog.js";
import type { CandidateScore, LivePlayer, SportslinePlayer } from "../src/domain/types.js";

const league = loadLeagueConfig("config/league.current.json");
const strategy = loadStrategyConfig("config/strategy.current.json");
const selectors = loadSelectorConfig("config/selectors.fixture.json");
const players = loadSportslineWorkbook("data/reference/cheatsheet_cbsppr12.xlsx");

function candidateFor(name: string, position: LivePlayer["position"]): CandidateScore {
  const player = requirePlayer(players, name, position);
  return {
    player: { ...player, available: true },
    score: 1,
    components: {
      sportslineRating: player.sportslineRating,
      adpValue: 0,
      rosterNeed: 0,
      scarcity: 0,
      nextPickRisk: 0,
      tierCliff: 0,
      penalties: 0
    },
    notes: ["fixture-confirm-test"]
  };
}

function rankTop(reader: CBSReader): Promise<CandidateScore> {
  return reader.readDraftState(players).then((state) => {
    const ranked = generateShortlist(
      players.map((player: SportslinePlayer) => ({
        ...player,
        available: state.availablePlayerIds.has(player.id)
      })),
      state,
      league,
      strategy
    );
    const decision = deterministicDecision(ranked);
    return ranked.find((candidate) => candidate.player.id === decision.selectedCandidateId) ?? ranked[0]!;
  });
}

async function openConfirmRoom(
  query: string
): Promise<{ server: FixtureServer; session: CBSSession }> {
  const server = await startFixtureServer();
  const session = await openEphemeralBrowser(true);
  await session.page.goto(`${server.url}?${query}`, { waitUntil: "domcontentloaded" });
  await session.page.waitForFunction("typeof window.__fixtureDraft === 'function'");
  return { server, session };
}

describe("fake room confirm-mode executor", () => {
  describe("10 successful confirms", () => {
    let server: FixtureServer;
    let session: CBSSession;
    let executor: FixtureExecutor;
    let reader: CBSReader;
    let firstPick!: CandidateScore;
    const logPath = path.join(os.tmpdir(), `fixture-confirm-${process.pid}.jsonl`);

    beforeAll(async () => {
      if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
      const opened = await openConfirmRoom("confirmMode=1&everyPickIsUser=1&intervalMs=50");
      server = opened.server;
      session = opened.session;
      reader = new CBSReader(session.page, selectors, league);
      executor = new FixtureExecutor(session.page, reader, selectors, league, strategy, logPath);
    }, 60000);

    afterAll(async () => {
      if (session) await closeSession(session);
      if (server) await server.close();
    });

    it("verifies 10 fake picks, then rejects duplicate submit and already-taken players", async () => {
      const drafted: string[] = [];
      for (let pick = 1; pick <= 10; pick += 1) {
        await session.page.waitForFunction(
          `() => document.querySelector("[data-testid='current-pick']")?.textContent?.trim() === "${pick}"`
        );
        const selected = await rankTop(reader);
        if (pick === 1) firstPick = selected;
        await executor.executeConfirmedPick(selected, pick);
        drafted.push(selected.player.name);
      }

      expect(executor.completedPicks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(new Set(drafted).size).toBe(10);
      expect(league.cbsExecutionEnabled).toBe(false);

      const results = await reader.readDraftResults();
      expect(results).toHaveLength(10);
      expect(results.every((row) => row.fantasyTeam === league.userTeamName)).toBe(true);
      expect(results.map((row) => row.playerName)).toEqual(drafted);

      const events = readEvents(logPath);
      expect(events.filter((event) => event.type === "pick_verified")).toHaveLength(10);
      expect(events.filter((event) => event.type === "pick_submitted")).toHaveLength(10);

      await expect(executor.executeConfirmedPick(firstPick, 1)).rejects.toMatchObject({
        kind: "duplicate"
      } satisfies Partial<FixtureExecutorError>);

      const current = (await reader.readLiveSnapshot(players)).control.currentOverallPick;
      expect(current).toBe(11);
      await expect(executor.executeConfirmedPick(firstPick, 11)).rejects.toMatchObject({
        kind: "unavailable"
      } satisfies Partial<FixtureExecutorError>);
      expect(executor.isDisabled).toBe(false);
    }, 120000);
  });

  describe("verification failure", () => {
    let server: FixtureServer;
    let session: CBSSession;

    beforeAll(async () => {
      const opened = await openConfirmRoom("confirmMode=1&everyPickIsUser=1&intervalMs=50");
      server = opened.server;
      session = opened.session;
    }, 60000);

    afterAll(async () => {
      if (session) await closeSession(session);
      if (server) await server.close();
    });

    it("disables the executor after a wrong-player result and refuses another click", async () => {
      const reader = new CBSReader(session.page, selectors, league);
      const executor = new FixtureExecutor(session.page, reader, selectors, league, strategy);
      await session.page.evaluate(`window.__fixtureConfirm = function () {
        return { ok: true };
      };`);

      const selected = candidateFor("Puka Nacua", "WR");
      await expect(executor.executeConfirmedPick(selected, 1)).rejects.toMatchObject({
        kind: "verification_failed"
      } satisfies Partial<FixtureExecutorError>);
      expect(executor.isDisabled).toBe(true);

      await expect(executor.executeConfirmedPick(candidateFor("Ja'Marr Chase", "WR"), 2)).rejects.toMatchObject({
        kind: "disabled"
      } satisfies Partial<FixtureExecutorError>);
    }, 60000);
  });

  describe("wrong team on the clock", () => {
    let server: FixtureServer;
    let session: CBSSession;

    beforeAll(async () => {
      const opened = await openConfirmRoom("confirmMode=1&intervalMs=5000");
      server = opened.server;
      session = opened.session;
    }, 60000);

    afterAll(async () => {
      if (session) await closeSession(session);
      if (server) await server.close();
    });

    it("refuses to click when Pickens My Jeanty is not on the clock", async () => {
      const reader = new CBSReader(session.page, selectors, league);
      const executor = new FixtureExecutor(session.page, reader, selectors, league, strategy);
      const snapshot = await reader.readLiveSnapshot(players);
      expect(snapshot.control.teamOnClock).toBe("Hairy Butterscotch");
      expect(snapshot.control.isUserTurn).toBe(false);

      await expect(executor.executeConfirmedPick(candidateFor("Puka Nacua", "WR"), 1)).rejects.toMatchObject({
        kind: "not_our_turn"
      } satisfies Partial<FixtureExecutorError>);
      expect(executor.isDisabled).toBe(false);
      expect(await reader.readDraftResults()).toEqual([]);
    }, 60000);

    it("refuses live selector config even on the fake room", async () => {
      const liveSelectors = loadSelectorConfig("config/selectors.example.json");
      const reader = new CBSReader(session.page, selectors, league);
      const executor = new FixtureExecutor(session.page, reader, liveSelectors, league, strategy);
      await expect(executor.executeConfirmedPick(candidateFor("Puka Nacua", "WR"), 1)).rejects.toMatchObject({
        kind: "not_fixture"
      } satisfies Partial<FixtureExecutorError>);
    });
  });
});
