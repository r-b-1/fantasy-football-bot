import { chromium, type BrowserContext, type Page } from "playwright";

export interface CBSSession {
  context: BrowserContext;
  page: Page;
}

export async function openCBSSession(profileDir: string): Promise<CBSSession> {
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: "chrome"
  });
  const pages = context.pages();
  const page = pages[0] ?? (await context.newPage());
  return { context, page };
}
