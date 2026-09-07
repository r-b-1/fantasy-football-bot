import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../src/cbs/fixtureServer.js";
import { openEphemeralBrowser, closeSession, type CBSSession } from "../src/cbs/session.js";

describe("rich fake room initial state", () => {
  let server: FixtureServer;
  let session: CBSSession;

  beforeAll(async () => {
    server = await startFixtureServer();
    session = await openEphemeralBrowser(true);
    await session.page.goto(`${server.richUrl}?autoplay=0`, {
      waitUntil: "domcontentloaded"
    });
    await session.page.waitForFunction(() => {
      const rows = document.querySelectorAll("[data-testid='roster-player']");
      return rows.length > 0;
    });
  }, 30000);

  afterAll(async () => {
    if (session) await closeSession(session);
    if (server) await server.close();
  });

  it("shows the user's keepers in the roster panel before any picks", async () => {
    const roster = await session.page.$$eval(
      "[data-testid='roster-player']",
      (els) => els.map((el) => el.textContent ?? "")
    );
    expect(roster.some((line) => line.includes("Ashton Jeanty") && line.includes("keeper"))).toBe(true);
    expect(roster.some((line) => line.includes("George Pickens") && line.includes("keeper"))).toBe(true);
  });

  it("removes keepers from the autopick pool", async () => {
    const pool = await session.page.evaluate(() => {
      const script = (window as unknown as { __script?: { autopickPool?: Array<{ name: string; _skip?: boolean }> } }).__script;
      return script?.autopickPool ?? [];
    });
    const keeperNames = ["Ashton Jeanty", "George Pickens", "Kenneth Walker III"];
    const keeperEntries = pool.filter((p) => keeperNames.includes(p.name));
    expect(keeperEntries.length).toBe(3);
    expect(keeperEntries.every((p) => p._skip === true)).toBe(true);
    const draftableNames = pool.filter((p) => !p._skip).map((p) => p.name);
    expect(draftableNames).not.toContain("Ashton Jeanty");
    expect(draftableNames).not.toContain("George Pickens");
    expect(draftableNames).not.toContain("Kenneth Walker III");
  });

  it("excludes keepers declared in the configured Docs roster grid", async () => {
    const draftableNames = await session.page.evaluate(() => {
      const script = (window as unknown as { __script: { autopickPool: Array<{ name: string; _skip?: boolean }> } }).__script;
      return script.autopickPool.filter((player) => !player._skip).map((player) => player.name);
    });
    expect(draftableNames).not.toContain("Puka Nacua");
    expect(draftableNames).not.toContain("Ja'Marr Chase");
    expect(draftableNames).toContain("Josh Jacobs");
    expect(await session.page.locator("[data-testid='league-keeper']").allTextContents())
      .toContain("Chase'n my Puka: Puka Nacua (WR)");
  });

  it("excludes all 32 keepers while retaining enough players for the full simulation", async () => {
    const script = await session.page.evaluate(() =>
      (window as unknown as { __script: {
        keepers: Array<{ name: string }>;
        autopickPool: Array<{ name: string; _skip?: boolean }>;
      } }).__script
    );
    const draftableNames = script.autopickPool.filter((player) => !player._skip).map((player) => player.name);
    expect(script.keepers).toHaveLength(32);
    expect(script.keepers.every((keeper) => !draftableNames.includes(keeper.name))).toBe(true);
    expect(draftableNames.length).toBeGreaterThanOrEqual(158);
  });

  it("shows the league-wide keeper list before any picks", async () => {
    const lines = await session.page.$$eval(
      "[data-testid='league-keeper']",
      (els) => els.map((el) => el.textContent ?? "")
    );
    expect(lines).toHaveLength(32);
    expect(lines).toContain("Pickens My Jeanty: Ashton Jeanty (RB)");
    expect(lines).toContain("Pickens My Jeanty: George Pickens (WR)");
    expect(lines).toContain("F.A.F.O.: Kenneth Walker III (RB)");
    expect(lines).toContain("Now we're Cookin': James Cook (RB)");
    expect(lines).toContain("Kickin Bass: Bijan Robinson (RB)");
    expect(lines).toContain("Doomsday Dingleberries: Travis Etienne (RB)");
    expect(lines).toContain("Doomsday Dingleberries: Bhayshul Tuten (RB)");
  });

  it("rejects manual picks of kept players, including CSV abbreviations", async () => {
    await session.page.waitForFunction(() => document.querySelector("[data-testid='current-pick']")?.textContent === "3");
    const before = await session.page.locator("[data-testid='draft-result-row']").count();
    for (const name of ["Ja'Marr Chase", "J'Marr Chase", "P Nacua", "Ashton Jeanty"]) {
      await session.page.locator("[data-testid='player-search']").fill(name);
      await session.page.locator("[data-testid='draft-action']").click();
      expect(await session.page.locator("[data-testid='pending-player']").textContent()).toBe("Cannot draft: already kept");
      expect(await session.page.locator("[data-testid='draft-confirmation']").isDisabled()).toBe(true);
    }
    expect(await session.page.locator("[data-testid='draft-result-row']").count()).toBe(before);
    await session.page.locator("[data-testid='player-search']").fill("Brock Bowers");
    await session.page.locator("[data-testid='draft-action']").click();
    await session.page.locator("[data-testid='draft-confirmation']").click();
    expect(await session.page.locator("[data-testid='result-player']").allTextContents()).toContain("Brock Bowers");
  });
});
