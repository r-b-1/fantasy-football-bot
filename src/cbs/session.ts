import fs from "node:fs";
import readline from "node:readline";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import {
  assertAllowedCbsUrl,
  isAllInTheFamilyHost,
  isAllowedCbsUrl,
  isCbsMockDraftRoom,
  leagueStartUrl,
  looksLikeCbsDraftRoom,
  pickDraftRoomUrl
} from "./allowlist.js";
import { domainNotAllowed } from "./errors.js";
import { dumpClickControls } from "./inspect.js";
import { classifyMockRoomPhase, looksLikeDraftActionLabel, playerPopupLooksOpen } from "./parse.js";
import type { SelectorConfig } from "./selectors.js";

export interface CBSSession {
  context: BrowserContext;
  page: Page;
  browser?: Browser;
}

export function resolveCbsBrowserProfileDir(kind: "live" | "mock" = "live"): string {
  if (kind === "mock") {
    return process.env.CBS_MOCK_BROWSER_PROFILE_DIR ?? ".local/cbs-mock-browser-profile";
  }
  return process.env.CBS_BROWSER_PROFILE_DIR ?? ".local/cbs-browser-profile";
}

export function explainCbsProfileLaunchError(profileDir: string, error: unknown): Error {
  const text = error instanceof Error ? error.message : String(error);
  if (/already in use|SingletonLock|user data dir|ProcessSingleton/i.test(text)) {
    return new Error(
      `CBS Chrome profile is already in use (${profileDir}). Stop companion or any other command using that Chrome profile, then retry.`
    );
  }
  return error instanceof Error ? error : new Error(text);
}

export async function openCBSSession(profileDir: string): Promise<CBSSession> {
  fs.mkdirSync(profileDir, { recursive: true });
  try {
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      channel: "chrome",
      args: ["--hide-crash-restore-bubble"]
    });
    const pages = context.pages();
    const page = pages[0] ?? (await context.newPage());
    return { context, page };
  } catch (error) {
    throw explainCbsProfileLaunchError(profileDir, error);
  }
}

export async function openEphemeralBrowser(headless: boolean): Promise<CBSSession> {
  const browser = await chromium.launch({ headless });
  const page = await browser.newPage();
  return { browser, context: page.context(), page };
}

export async function closeSession(session: CBSSession): Promise<void> {
  await session.context.close();
  if (session.browser) await session.browser.close();
}

export async function openAllowlistedUrl(page: Page, url: string): Promise<void> {
  assertAllowedCbsUrl(url);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  if (!isAllowedCbsUrl(page.url())) {
    throw domainNotAllowed(page.url());
  }
}

export async function openAllowlistedCbsPage(
  page: Page,
  draftRoomUrlPattern: string
): Promise<void> {
  await openAllowlistedUrl(page, leagueStartUrl(draftRoomUrlPattern));
}

export async function openLoggedInDraftRoom(options: {
  profileDir: string;
  startUrl: string;
  preferredPattern?: string;
  prompt: string;
}): Promise<{ session: CBSSession; focused: { page: Page; urls: string[] } }> {
  const session = await openCBSSession(options.profileDir);
  try {
    await openAllowlistedUrl(session.page, options.startUrl);
    await waitForManualLogin(options.prompt);
    const focused = await focusDraftRoomPage(session, options.preferredPattern);
    return { session, focused };
  } catch (error) {
    await session.context.close();
    throw error;
  }
}

export async function waitForManualLogin(prompt: string): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new Error(
      "This command needs an interactive terminal so you can press Enter. Run it in your own terminal, not a piped command."
    );
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>((resolve) => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

/**
 * CBS Draft Room often opens as a new window. After the user clicks into it,
 * attach to that page instead of staying on league feed.
 */
export async function focusDraftRoomPage(
  session: CBSSession,
  preferredPattern?: string
): Promise<{ page: Page; urls: string[] }> {
  for (const page of session.context.pages()) {
    const url = page.url();
    if (!url || url === "about:blank") {
      await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => undefined);
    }
  }
  const pages = session.context.pages();
  const urls = pages.map((page) => page.url());
  const chosen = pickDraftRoomUrl(urls, preferredPattern);
  const match = chosen ? pages.find((page) => page.url() === chosen) : undefined;
  if (match) {
    session.page = match;
    await match.bringToFront().catch(() => undefined);
  }
  return { page: session.page, urls };
}

export async function waitForPublicMockDraftRoom(
  session: CBSSession,
  options: { intervalMs?: number } = {}
): Promise<{ page: Page; urls: string[] }> {
  const intervalMs = options.intervalMs ?? 2000;
  let lastNotice = 0;
  for (;;) {
    const focused = await focusDraftRoomPage(session);
    for (const open of focused.urls) {
      if (isAllInTheFamilyHost(open)) {
        throw new Error("Mock confirm refused the All in the Family draft room.");
      }
    }
    const mockPage = session.context.pages().find((page) => isCbsMockDraftRoom(page.url()));
    if (mockPage) {
      session.page = mockPage;
      await mockPage.bringToFront().catch(() => undefined);
      return { page: mockPage, urls: session.context.pages().map((open) => open.url()) };
    }
    if (Date.now() - lastNotice > 15_000) {
      console.log("Waiting for you to join a public mock (Join Now). This command will not click Join.");
      lastNotice = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function locatorSample(page: Page, selector: string | null): Promise<string> {
  if (!selector) return "";
  return page
    .locator(selector)
    .first()
    .innerText({ timeout: 800 })
    .catch(() => "");
}

export async function waitUntilMockYouAreUp(
  session: CBSSession,
  selectors: SelectorConfig,
  options: { intervalMs?: number } = {}
): Promise<{ page: Page; urls: string[] }> {
  const intervalMs = options.intervalMs ?? 2000;
  let lastNotice = 0;
  for (;;) {
    const focused = await waitForPublicMockDraftRoom(session, { intervalMs });
    const statusText = await locatorSample(focused.page, selectors.selectors.currentPick);
    const youAreUpText = await locatorSample(focused.page, selectors.selectors.youAreUpIndicator);
    const teamOnClockText = await locatorSample(focused.page, selectors.selectors.teamOnClock);
    const haystack = ((await focused.page
      .evaluate(`(() => (document.body ? document.body.innerText || "" : "").replace(/\\s+/g, " "))()`)
      .catch(() => "")) as string).slice(0, 4000);
    const phase = classifyMockRoomPhase({
      statusText,
      youAreUpText: `${youAreUpText} ${teamOnClockText}`,
      haystack
    });
    if (phase === "on_clock") {
      console.log("YOU ARE ON THE CLOCK. Chrome will stay open so you can click a player name.");
      return focused;
    }
    if (Date.now() - lastNotice > 15_000) {
      const sample = haystack.match(/you(?:['’]re| are)[^.|]{0,40}/i)?.[0] ?? "(no you-are-up copy)";
      if (phase === "completed") {
        console.log(
          "This mock draft is finished. Join a new live mock in this Chrome window. Waiting until YOU ARE ON THE CLOCK."
        );
      } else {
        console.log(
          `Mock room is open. Waiting until YOU ARE ON THE CLOCK so the player-name popup and Draft button are visible. Saw: ${sample}. Do not click Autopilot.`
        );
      }
      lastNotice = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function waitUntilMockPlayerPopupOpen(
  session: CBSSession,
  options: { intervalMs?: number } = {}
): Promise<{ page: Page; urls: string[] }> {
  const intervalMs = options.intervalMs ?? 1000;
  let lastNotice = 0;
  console.log("Click a player name in the list. Do not click Draft or Autopilot. Leave that popup open.");
  for (;;) {
    const focused = await waitForPublicMockDraftRoom(session, { intervalMs });
    const clickDump = await dumpClickControls(focused.page).catch(() => null);
    const draftControl = clickDump?.controls.find((control) => looksLikeDraftActionLabel(control.label));
    if (draftControl || playerPopupLooksOpen(clickDump?.popupText ?? "")) {
      console.log(
        draftControl
          ? `Saw Draft control ${draftControl.tag}${draftControl.id ? `#${draftControl.id}` : ""}. Dumping locators.`
          : "Player popup shows Draft. Dumping locators."
      );
      return { page: focused.page, urls: session.context.pages().map((open) => open.url()) };
    }
    if (Date.now() - lastNotice > 8_000) {
      console.log(
        "Still waiting for a visible Draft button. The player card/snippet is not enough. Click a name in the list and leave the Draft popup open."
      );
      lastNotice = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function pickReadableDraftRoomPage(
  session: CBSSession,
  selectors: SelectorConfig,
  preferredPattern?: string
): Promise<{ page: Page; urls: string[] }> {
  const focused = await focusDraftRoomPage(session, preferredPattern);
  const probe =
    selectors.selectors.countdownClock ??
    selectors.selectors.currentPick ??
    selectors.selectors.youAreUpIndicator;
  if (!probe) return focused;
  for (const page of session.context.pages()) {
    if (!looksLikeCbsDraftRoom(page.url())) continue;
    const visible = await page
      .locator(probe)
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    if (visible) {
      session.page = page;
      await page.bringToFront().catch(() => undefined);
      return { page, urls: session.context.pages().map((open) => open.url()) };
    }
  }
  return focused;
}

export async function summarizeAccessibility(page: Page): Promise<string[]> {
  const headings = page.getByRole("heading");
  const buttons = page.getByRole("button");
  const tabs = page.getByRole("tab");
  const headingCount = await headings.count();
  const buttonCount = await buttons.count();
  const tabCount = await tabs.count();
  const lines = [
    `URL: ${page.url()}`,
    `Title: ${await page.title()}`,
    `Headings: ${headingCount}`,
    `Buttons: ${buttonCount}`,
    `Tabs: ${tabCount}`
  ];

  const limit = Math.min(headingCount, 25);
  for (let i = 0; i < limit; i += 1) {
    const name = (await headings.nth(i).innerText().catch(() => "")).trim();
    if (name) lines.push(`  heading: ${name.slice(0, 120)}`);
  }
  const tabLimit = Math.min(tabCount, 20);
  for (let i = 0; i < tabLimit; i += 1) {
    const name = (await tabs.nth(i).innerText().catch(() => "")).trim();
    if (name) lines.push(`  tab: ${name.slice(0, 120)}`);
  }
  return lines;
}
