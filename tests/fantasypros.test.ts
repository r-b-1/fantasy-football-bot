import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadFantasyProsPreview, parseFantasyProsProjections, FANTASY_PROS_LOCAL_REQUEST_LIMIT } from "../src/data/fantasyPros.js";

function responseBody() {
  return {
    season: "2026", week: "0", count: "100",
    players: [{
      fpid: "123", name: "Example Runner", position_id: "RB", team_id: "BUF",
      image_url: "https://example.invalid/do-not-cache.png",
      stats: { points_ppr: "210.5", points: 170, historic_points: 150 }
    }]
  };
}

describe("FantasyPros projection validation", () => {
  it("keeps only permitted preview fields and uses PPR points, not standard points", () => {
    const data = parseFantasyProsProjections(responseBody(), 2026, "RB");
    expect(data.purpose).toBe("sample-preview-only");
    expect(data.players[0]?.projectedPprPoints).toBe(210.5);
    expect(data.reportedCount).toBe(100);
    expect(data.players).toHaveLength(1);
    expect(JSON.stringify(data)).not.toMatch(/image_url|historic_points|example.invalid/);
  });

  it("accepts the documented single-item stats array but rejects ambiguous multiple entries", () => {
    const body = responseBody();
    const player = body.players[0]!;
    expect(parseFantasyProsProjections({ ...body, players: [{ ...player, stats: [player.stats] }] }, 2026, "RB")
      .players[0]?.projectedPprPoints).toBe(210.5);
    expect(() => parseFantasyProsProjections({ ...body, players: [{ ...player, stats: [player.stats, player.stats] }] }, 2026, "RB"))
      .toThrow(/unsupported projection schema/);
  });

  it.each([null, "", "not-a-number"])("rejects missing or invalid PPR points (%s)", (points) => {
    const body = responseBody();
    expect(() => parseFantasyProsProjections({
      ...body, players: [{ ...body.players[0], stats: { points_ppr: points } }]
    }, 2026, "RB")).toThrow(/unsupported projection schema/);
  });

  it("rejects wrong season/week/position and duplicate player IDs", () => {
    const body = responseBody();
    expect(() => parseFantasyProsProjections(body, 2025, "RB")).toThrow(/wrong season/);
    expect(() => parseFantasyProsProjections({ ...body, week: "1" }, 2026, "RB")).toThrow(/wrong season/);
    expect(() => parseFantasyProsProjections(body, 2026, "QB")).toThrow(/wrong season/);
    expect(() => parseFantasyProsProjections({ ...body, players: [...body.players, ...body.players] }, 2026, "RB"))
      .toThrow(/duplicate player IDs/);
  });

  it.each([null, {}, []])("handles empty projection responses without inventing player data (%j)", (players) => {
    const data = parseFantasyProsProjections({ ...responseBody(), count: "0", players }, 2026, "RB");
    expect(data.players).toEqual([]);
    expect(data.reportedCount).toBe(0);
  });
});

describe("FantasyPros request safeguards (mock transport only)", () => {
  let cacheDir: string;
  const apiKey = "test-secret-never-persist";
  const fetchImpl = vi.fn<typeof fetch>();
  const options = () => ({ season: 2026, position: "RB" as const, cacheDir, apiKey, fetchImpl });
  const cachePath = () => path.join(cacheDir, "nfl-2026-preseason-RB.json");
  const usagePath = () => path.join(cacheDir, "usage.json");

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "fantasypros-test-"));
    fetchImpl.mockReset();
    fetchImpl.mockResolvedValue(Response.json(responseBody()));
  });
  afterEach(() => fs.rmSync(cacheDir, { recursive: true, force: true }));

  it("makes zero requests on cache miss unless explicitly refreshed", async () => {
    await expect(loadFantasyProsPreview(options())).rejects.toThrow(/--refresh explicitly/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refreshes once, then reads cached data without a key or another request", async () => {
    const first = await loadFantasyProsPreview({ ...options(), refresh: true });
    expect(first.requestsMade).toBe(1);
    expect(first.locallyRecordedAttempts).toBe(1);
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(
      "https://api.fantasypros.com/public/v2/json/nfl/2026/projections?position=RB&week=0&ros=false",
      expect.objectContaining({ redirect: "error", headers: { "x-api-key": apiKey, Accept: "application/json" } })
    );
    const second = await loadFantasyProsPreview({ ...options(), apiKey: undefined });
    expect(second.data).toEqual(first.data);
    expect(second.requestsMade).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(cachePath(), "utf8") + fs.readFileSync(usagePath(), "utf8")).not.toContain(apiKey);
    expect(fs.statSync(cachePath()).mode & 0o777).toBe(0o600);
  });

  it.each([401, 403, 429, 500])("counts HTTP %i failures without retries or caching error bodies", async (status) => {
    fetchImpl.mockResolvedValue(new Response(`Error containing ${apiKey}`, { status }));
    await expect(loadFantasyProsPreview({ ...options(), refresh: true })).rejects.toThrow(`HTTP ${status}; one attempt recorded, no retry made`);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fs.readFileSync(usagePath(), "utf8")).attempts).toBe(1);
    expect(fs.existsSync(cachePath())).toBe(false);
    expect(fs.existsSync(path.join(cacheDir, "refresh.lock"))).toBe(false);
  });

  it("counts transport failures without exposing errors that could contain secrets", async () => {
    fetchImpl.mockRejectedValue(new Error(apiKey));
    await expect(loadFantasyProsPreview({ ...options(), refresh: true })).rejects.toThrow(
      "FantasyPros request failed or returned invalid JSON; one attempt recorded, no retry made."
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fs.readFileSync(usagePath(), "utf8")).attempts).toBe(1);
  });

  it("preserves an existing cache when a refresh returns invalid data", async () => {
    const cached = parseFantasyProsProjections(responseBody(), 2026, "RB");
    fs.writeFileSync(cachePath(), JSON.stringify(cached));
    fetchImpl.mockResolvedValue(Response.json({ error: apiKey }));
    await expect(loadFantasyProsPreview({ ...options(), refresh: true })).rejects.toThrow(/unsupported projection schema/);
    expect(JSON.parse(fs.readFileSync(cachePath(), "utf8"))).toEqual(cached);
    const diagnostic = fs.readFileSync(path.join(cacheDir, "nfl-2026-preseason-RB-diagnostic.json"), "utf8");
    expect(diagnostic).not.toContain(apiKey);
    expect(diagnostic).toContain("<REDACTED>");
  });

  it("blocks refresh without a key or after the local safety cap", async () => {
    await expect(loadFantasyProsPreview({ ...options(), apiKey: undefined, refresh: true })).rejects.toThrow(/not set/);
    fs.writeFileSync(usagePath(), JSON.stringify({ attempts: FANTASY_PROS_LOCAL_REQUEST_LIMIT, lastAttemptAt: null }));
    await expect(loadFantasyProsPreview({ ...options(), refresh: true })).rejects.toThrow(/safety cap/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("blocks rapid or concurrent refreshes before sending", async () => {
    fs.writeFileSync(usagePath(), JSON.stringify({ attempts: 1, lastAttemptAt: Date.now() }));
    await expect(loadFantasyProsPreview({ ...options(), refresh: true })).rejects.toThrow(/one second apart/);
    fs.writeFileSync(path.join(cacheDir, "refresh.lock"), "");
    await expect(loadFantasyProsPreview({ ...options(), refresh: true })).rejects.toThrow(/refresh lock/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
