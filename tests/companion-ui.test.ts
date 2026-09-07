import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { startCompanionServer } from "../src/companion/server.js";

let browser: Browser;
let page: Page;
let server: Awaited<ReturnType<typeof startCompanionServer>>;
let origin: string;
let errors: string[];

beforeAll(async () => {
  server = await startCompanionServer(0);
  origin = `http://127.0.0.1:${server.port}`;
  browser = await chromium.launch();
});
beforeEach(async () => {
  await fetch(`${origin}/api/room/disconnect`, { method: "POST" });
  const reset = await fetch(`${origin}/api/reset`, { method: "POST" });
  expect(reset.status).toBe(200);
  page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, hasTouch: true });
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Browser workflows remain usable without the optional web fonts.
  if (!process.env.COMPANION_SCREENSHOT_DIR) {
    await page.route("https://fonts.**/*", (route) => route.abort());
  }
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !document.querySelector<HTMLInputElement>("#playerSearch")?.disabled);
});
afterEach(async () => {
  await page.close();
  expect(errors).toEqual([]);
});
afterAll(async () => {
  await browser.close();
  await server.stop();
});

async function waitForPick(pick: number) {
  await page.waitForFunction((value) =>
    document.querySelector("#currentPick")?.textContent === String(value).padStart(2, "0") &&
    !document.querySelector<HTMLInputElement>("#playerSearch")?.disabled, pick);
}

it("records through keyboard autocomplete, updates the roster, switches source, undoes and resets", async () => {
  expect(await page.locator("#keeperCount").textContent()).toBe("32");
  expect(await page.locator("#rosterCount").textContent()).toBe("2 players");
  expect(await page.locator("#clockTeam").textContent()).toBe("Hairy Butterscotch");
  expect(await page.locator(".rec").count()).toBeGreaterThan(0);
  if (process.env.COMPANION_SCREENSHOT_DIR) {
    await page.screenshot({ path: `${process.env.COMPANION_SCREENSHOT_DIR}/companion-desktop.png`, fullPage: true });
  }
  await page.keyboard.press("/");
  expect(await page.locator("#playerSearch").evaluate((node) => node === document.activeElement)).toBe(true);
  await page.getByRole("combobox", { name: "Search available players" }).fill("nico");
  expect(await page.locator("#playerResults").textContent()).toContain("Nico Collins");
  await page.keyboard.press("ArrowDown");
  expect(await page.locator("#playerSearch").getAttribute("aria-activedescendant")).toBe("player-option-0");
  await page.keyboard.press("Enter");
  expect(await page.locator("#selectedName").textContent()).toBe("Nico Collins");
  expect(await page.locator("#currentPick").textContent()).toBe("01");
  await page.getByRole("button", { name: "Record pick", exact: false }).click();
  await waitForPick(2);
  expect(await page.locator("#historyList").textContent()).toContain("Nico Collins");
  await page.locator("#playerSearch").fill("nico");
  expect(await page.locator("#noResults").isVisible()).toBe(true);
  await page.locator("#playerSearch").fill("rashee");
  await page.getByRole("option", { name: /^Rashee Rice / }).click();
  await page.locator("#submitPick").click();
  await waitForPick(3);
  expect(await page.locator("#turnLabel").textContent()).toBe("You're on the clock");
  await page.locator("#playerSearch").fill("bowers");
  await page.keyboard.press("Enter");
  await page.locator("#submitPick").click();
  await waitForPick(4);
  expect(await page.locator("#rosterList").textContent()).toContain("Brock Bowers");
  expect(await page.locator("#rosterCount").textContent()).toBe("3 players");
  await page.selectOption("#sourceSelect", "sportsline");
  await page.waitForFunction(() => document.querySelector("#notice")?.textContent?.includes("Ranking source updated"));
  expect(await page.locator("#historyCount").textContent()).toBe("3");
  await page.locator("#undoBtn").click();
  await waitForPick(3);
  expect(await page.locator("#rosterList").textContent()).not.toContain("Brock Bowers");
  await page.locator("#resetBtn").click();
  await page.locator("#cancelReset").click();
  expect(await page.locator("#historyCount").textContent()).toBe("2");
  await page.locator("#resetBtn").click();
  await page.locator("#confirmReset").click();
  await waitForPick(1);
  expect(await page.locator("#keeperCount").textContent()).toBe("32");
}, 30000);

it("supports touch selection, keeper inspection and narrow layouts", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator("#playerSearch").fill("jeanty");
  expect(await page.locator("#noResults").isVisible()).toBe(true);
  expect(await page.locator("#submitPick").isDisabled()).toBe(true);
  await page.locator("#playerSearch").fill("dandre swift");
  expect(await page.getByRole("option", { name: /^D'Andre Swift / }).textContent()).toContain("D'Andre Swift");
  if (process.env.COMPANION_SCREENSHOT_DIR) {
    await page.screenshot({ path: `${process.env.COMPANION_SCREENSHOT_DIR}/companion-mobile-search.png`, fullPage: true });
  }
  await page.getByRole("option", { name: /^D'Andre Swift / }).tap();
  await page.locator("#submitPick").click();
  await waitForPick(2);
  await page.locator(".keepers-section > summary").click();
  expect(await page.locator(".keeper-team").count()).toBe(16);
  const fafo = page.locator(".keeper-team").filter({ hasText: "F.A.F.O." });
  expect(await fafo.textContent()).toContain("Kenneth Walker III");
  await page.locator(".rec details > summary").first().click();
  expect(await page.locator(".rec details").first().getAttribute("open")).not.toBeNull();
  for (const width of [320, 600, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `No overflow at ${width}px`).toBe(true);
  }
}, 30000);

it("blocks duplicate submissions and recovers from stale state without recording the wrong pick", async () => {
  await page.locator("#playerSearch").fill("nico");
  await page.keyboard.press("Enter");
  const recorded = await fetch(`${origin}/api/picks`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerName: "Rashee Rice", position: "WR", expectedOverallPick: 1 })
  });
  expect(recorded.status).toBe(200);
  await page.locator("#submitPick").click();
  await page.waitForFunction(() => document.querySelector("#notice")?.classList.contains("error"));
  expect(await page.locator("#notice").textContent()).toContain("Draft has advanced");
  expect(await page.locator("#submitPick").isDisabled()).toBe(true);
  await page.locator("#retryBtn").click();
  await waitForPick(2);
  expect(await page.locator("#historyList").textContent()).not.toContain("Nico Collins");
  await page.locator("#playerSearch").fill("nico");
  await page.keyboard.press("Enter");
  await page.route("**/api/picks", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.continue();
  });
  await page.locator("#submitPick").evaluate((button) => {
    if (button instanceof HTMLButtonElement) { button.click(); button.click(); }
  });
  await waitForPick(3);
  expect(await page.locator("#historyCount").textContent()).toBe("2");
}, 30000);

it("watches the local draft room, locks recording, then lets a manual pick continue after disconnect", async () => {
  expect(await page.locator("#watchLiveBtn").isHidden()).toBe(true);
  expect(await page.locator("#roomLabelText").textContent()).toBe("Manual companion");
  await page.getByRole("button", { name: "Watch local room" }).click();
  await page.waitForFunction(() =>
    document.querySelector("#roomLabelText")?.textContent === "Watching local draft room" &&
    document.querySelector<HTMLInputElement>("#playerSearch")?.disabled === true, null, { timeout: 30000 });
  await page.waitForFunction(() => Number(document.querySelector("#historyCount")?.textContent) >= 2, null, { timeout: 20000 });
  expect(await page.locator("#historyList").textContent()).toContain("Josh Jacobs");
  expect(await page.locator("#draftOrderLabel").textContent()).toBe("CBS draft order");
  expect(await page.locator("#draftOrder").textContent()).toContain("Spider Monkeys");
  expect(await page.locator("#draftOrderNote").textContent()).toMatch(/snake/i);
  expect(await page.locator("#pickInterval").textContent()).toContain("between picks");
  expect(await page.locator("#submitPick").isDisabled()).toBe(true);
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.waitForFunction(() =>
    document.querySelector("#roomLabelText")?.textContent === "Manual companion" &&
    !document.querySelector<HTMLInputElement>("#playerSearch")?.disabled, null, { timeout: 15000 });
  const remaining = Number(await page.locator("#historyCount").textContent());
  expect(remaining).toBeGreaterThanOrEqual(2);
  await page.locator("#playerSearch").fill("nico");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Record pick", exact: false }).click();
  await waitForPick(remaining + 2);
  expect(await page.locator("#historyList").textContent()).toContain("Nico Collins");
}, 60000);

it("keeps manual recording usable when recommendation loading fails", async () => {
  await page.route("**/api/recommend", (route) => route.fulfill({
    status: 500, contentType: "application/json", body: JSON.stringify({ error: "Recommendation service unavailable" })
  }));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !document.querySelector<HTMLInputElement>("#playerSearch")?.disabled);
  expect(await page.locator("#recommendList").textContent()).toContain("Suggestions unavailable");
  await page.locator("#playerSearch").fill("nico");
  await page.keyboard.press("Enter");
  await page.locator("#submitPick").click();
  await waitForPick(2);
  expect(await page.locator("#historyList").textContent()).toContain("Nico Collins");
}, 30000);
