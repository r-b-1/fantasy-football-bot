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
    console.log("DEBUG roster:", JSON.stringify(roster));
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
    console.log("DEBUG keeper entries:", JSON.stringify(keeperEntries));
    expect(keeperEntries.length).toBe(3);
    expect(keeperEntries.every((p) => p._skip === true)).toBe(true);
    const draftableNames = pool.filter((p) => !p._skip).map((p) => p.name);
    expect(draftableNames).not.toContain("Ashton Jeanty");
    expect(draftableNames).not.toContain("George Pickens");
    expect(draftableNames).not.toContain("Kenneth Walker III");
  });

  it("shows the league-wide keeper list before any picks", async () => {
    const lines = await session.page.$$eval(
      "[data-testid='league-keeper']",
      (els) => els.map((el) => el.textContent ?? "")
    );
    console.log("DEBUG league-keepers:", JSON.stringify(lines));
    expect(lines).toContain("Pickens My Jeanty: Ashton Jeanty (RB)");
    expect(lines).toContain("Pickens My Jeanty: George Pickens (WR)");
    expect(lines).toContain("Now we're Cookin': Kenneth Walker III (RB)");
  });
});