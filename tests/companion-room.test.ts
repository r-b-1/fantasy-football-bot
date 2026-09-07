import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startCompanionServer } from "../src/companion/server.js";
import { assertCompanionCanWatchLive } from "../src/companion/roomBridge.js";
import { loadLeagueConfig } from "../src/config/load.js";
import { loadSelectorConfig } from "../src/cbs/selectors.js";

interface ServerHandle { port: number; stop: () => Promise<void> }

let server: ServerHandle | null = null;

async function fetchJson(url: string, options?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, options);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

async function waitForState(
  port: number,
  predicate: (state: Record<string, unknown>) => boolean,
  timeout = 25000
): Promise<Record<string, unknown>> {
  const started = Date.now();
  let last: Record<string, unknown> | null = null;
  while (Date.now() - started < timeout) {
    const { status, body } = await fetchJson(`http://127.0.0.1:${port}/api/state`);
    last = body;
    if (status === 200 && predicate(body)) return body;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for companion room state: ${JSON.stringify(last)}`);
}

describe("companion live-watch guards", () => {
  it("allows read-only live watching for the current recommend-mode league", () => {
    expect(() =>
      assertCompanionCanWatchLive(
        loadLeagueConfig("config/league.current.json"),
        loadSelectorConfig("config/selectors.live.json")
      )
    ).not.toThrow();
  });

  it("refuses live watching when CBS execution is enabled or fixture selectors are supplied", () => {
    const league = loadLeagueConfig("config/league.current.json");
    league.cbsExecutionEnabled = true;
    expect(() =>
      assertCompanionCanWatchLive(league, loadSelectorConfig("config/selectors.live.json"))
    ).toThrow(/cbsExecutionEnabled/);
    const confirm = loadLeagueConfig("config/league.current.json");
    confirm.executionMode = "confirm";
    expect(() =>
      assertCompanionCanWatchLive(confirm, loadSelectorConfig("config/selectors.live.json"))
    ).toThrow(/executionMode=confirm/);
    expect(() =>
      assertCompanionCanWatchLive(
        loadLeagueConfig("config/league.current.json"),
        loadSelectorConfig("config/selectors.fixture.json")
      )
    ).toThrow(/Fixture selectors cannot be used against live CBS/);
  });
});

describe("companion draft-room hookup", { timeout: 60000 }, () => {
  beforeEach(async () => {
    server = await startCompanionServer(0);
    const reset = await fetch(`http://127.0.0.1:${server.port}/api/reset`, { method: "POST" });
    expect(reset.status).toBe(200);
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it("refuses live CBS attach in the test process and rejects a second room", async () => {
    const live = await fetchJson(`http://127.0.0.1:${server!.port}/api/room/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "live" })
    });
    expect(live.status).toBe(403);
    expect(live.body.error).toMatch(/disabled in this companion process/);

    const bad = await fetchJson(`http://127.0.0.1:${server!.port}/api/room/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "cbs" })
    });
    expect(bad.status).toBe(400);
  });

  it("mirrors fixture room picks into companion state and unlocks local recording after disconnect", async () => {
    const base = `http://127.0.0.1:${server!.port}`;
    const connected = await fetchJson(`${base}/api/room/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "fixture",
        pauseOnUser: false,
        autoplay: true,
        intervalMs: 80,
        untilPick: 4
      })
    });
    expect(connected.status).toBe(200);
    expect((connected.body.room as { kind: string; status: string; writable: boolean }).kind).toBe("fixture");
    expect((connected.body.room as { writable: boolean }).writable).toBe(false);

    const again = await fetchJson(`${base}/api/room/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "fixture", untilPick: 2 })
    });
    expect(again.status).toBe(409);

    const watching = await waitForState(server!.port, (state) => Number(state.draftedCount) >= 2);
    expect((watching.room as { status: string; writable: boolean }).status).toBe("watching");
    expect((watching.room as { writable: boolean }).writable).toBe(false);
    expect((watching.picks as { playerName: string; fantasyTeam: string }[])[0]).toMatchObject({
      overallPick: 1,
      fantasyTeam: "Hairy Butterscotch",
      playerName: "Josh Jacobs"
    });
    expect(watching.currentOverallPick).toBeGreaterThanOrEqual(2);
    expect((watching.availablePlayers as { name: string }[]).some((player) => player.name === "Josh Jacobs")).toBe(false);
    expect(watching.draftOrderSource).toBe("cbs");
    expect(watching.draftOrder as string[]).toHaveLength(16);
    expect(watching.draftOrder as string[]).toContain("Spider Monkeys");
    expect(watching.draftOrder as string[]).not.toContain("NJigBA Please");
    expect(watching.pickIntervalLabel).toBe("1 minute 30 seconds between picks");
    expect(watching.secondsPerPick).toBe(90);

    const blocked = await fetchJson(`${base}/api/picks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerName: "Nico Collins", position: "WR" })
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/Disconnect to record picks locally/);
    expect((await fetchJson(`${base}/api/reset`, { method: "POST" })).status).toBe(409);
    expect((await fetchJson(`${base}/api/undo`, { method: "POST" })).status).toBe(409);

    const rec = await fetchJson(`${base}/api/recommend`);
    expect(rec.status).toBe(200);
    expect(((rec.body.recommendations as unknown[]) ?? []).length).toBeGreaterThan(0);

    const disconnected = await fetchJson(`${base}/api/room/disconnect`, { method: "POST" });
    expect(disconnected.status).toBe(200);
    expect((disconnected.body.room as { writable: boolean; status: string }).writable).toBe(true);

    const after = await fetchJson(`${base}/api/state`);
    expect(after.status).toBe(200);
    expect(after.body.draftedCount).toBe(watching.draftedCount);
    expect((after.body.room as { status: string }).status).toBe("disconnected");

    const { body: recAfter } = await fetchJson(`${base}/api/recommend`);
    const nextId = (recAfter.recommendations as { playerId: string }[])[0]!.playerId;
    const recorded = await fetchJson(`${base}/api/picks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: nextId })
    });
    expect(recorded.status).toBe(200);
    const continued = await fetchJson(`${base}/api/state`);
    expect(continued.body.draftedCount).toBe(Number(watching.draftedCount) + 1);
  });
});
