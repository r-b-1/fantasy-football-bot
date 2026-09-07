import type { Page } from "playwright";
import { cbsPlayerRowMatchTexts } from "./parse.js";
import type { SelectorConfig } from "./selectors.js";

/**
 * Clicks only locators already stored in selector config.
 * Never invents CBS search/draft/confirm selectors.
 */
export async function performConfiguredPickClicks(
  page: Page,
  selectors: SelectorConfig["selectors"],
  playerName: string
): Promise<void> {
  const draft = selectors.draftAction;
  if (!draft) {
    throw new Error("Configured pick clicks require draftAction.");
  }
  if (selectors.playerRows && selectors.playerNameWithinRow) {
    const row = await locatePlayerRow(page, selectors.playerRows, playerName);
    await row.waitFor({ state: "visible", timeout: 5000 });
    const nameCell = row.locator(selectors.playerNameWithinRow).first();
    const nameLink = nameCell.locator("a").first();
    if ((await nameLink.count()) > 0) {
      await nameLink.click({ timeout: 2000 });
    } else {
      await nameCell.click({ timeout: 2000 });
    }
  } else if (selectors.playerSearchInput) {
    const searchBox = page.locator(selectors.playerSearchInput).first();
    await searchBox.waitFor({ state: "visible", timeout: 5000 });
    await searchBox.fill(playerName);
  } else {
    throw new Error("Configured pick clicks require player rows or a search box.");
  }
  const draftButton = page.locator(draft).filter({ visible: true }).first();
  await draftButton.waitFor({ state: "visible", timeout: 5000 });
  if (!(await draftButton.isEnabled().catch(() => false))) {
    throw new Error("Configured draft control is visible but disabled.");
  }
  await draftButton.click({ timeout: 2000 });
  if (selectors.draftConfirmation) {
    const confirm = page.locator(selectors.draftConfirmation).filter({ visible: true }).first();
    await confirm.waitFor({ state: "visible", timeout: 5000 });
    await confirm.click({ timeout: 2000 });
  }
}

async function locatePlayerRow(page: Page, playerRows: string, playerName: string) {
  const rows = page.locator(playerRows);
  for (const text of cbsPlayerRowMatchTexts(playerName)) {
    const match = rows.filter({ hasText: text });
    if ((await match.count()) > 0) return match.first();
  }
  return rows.filter({ hasText: playerName }).first();
}
