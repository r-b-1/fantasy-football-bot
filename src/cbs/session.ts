import fs from "node:fs";
import readline from "node:readline";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { assertAllowedCbsUrl, isAllowedCbsUrl, leagueOrigin, pickDraftRoomUrl } from "./allowlist.js";
import { domainNotAllowed } from "./errors.js";

export interface CBSSession {
  context: BrowserContext;
  page: Page;
  browser?: Browser;
}

export async function openCBSSession(profileDir: string): Promise<CBSSession> {
  fs.mkdirSync(profileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: "chrome"
  });
  const pages = context.pages();
  const page = pages[0] ?? (await context.newPage());
  return { context, page };
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

export async function openAllowlistedCbsPage(
  page: Page,
  draftRoomUrlPattern: string
): Promise<void> {
  const target = leagueOrigin(draftRoomUrlPattern);
  assertAllowedCbsUrl(target);
  await page.goto(target, { waitUntil: "domcontentloaded" });
  if (!isAllowedCbsUrl(page.url())) {
    throw domainNotAllowed(page.url());
  }
}

export async function waitForManualLogin(prompt: string): Promise<void> {
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
