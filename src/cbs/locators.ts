import type { Locator, Page } from "playwright";
import { selectorMissing, selectorUnresolved } from "./errors.js";

export function locatorFromConfig(page: Page, selector: string | null, field: string): Locator {
  if (!selector) throw selectorMissing(field);
  return page.locator(selector);
}

export async function readVisibleText(
  page: Page,
  selector: string | null,
  field: string
): Promise<string> {
  const locator = locatorFromConfig(page, selector, field).first();
  try {
    await locator.waitFor({ state: "visible", timeout: 5000 });
  } catch {
    throw selectorUnresolved(field, selector ?? "");
  }
  const text = (await locator.innerText()).trim();
  if (!text) throw selectorUnresolved(field, selector ?? "");
  return text;
}

export async function isVisible(
  page: Page,
  selector: string | null,
  field: string
): Promise<boolean> {
  if (!selector) throw selectorMissing(field);
  return locatorFromConfig(page, selector, field).first().isVisible().catch(() => false);
}

export async function readAllInnerTexts(
  page: Page,
  selector: string | null,
  field: string
): Promise<string[]> {
  const locator = locatorFromConfig(page, selector, field);
  const count = await locator.count();
  if (count === 0) throw selectorUnresolved(field, selector ?? "");
  const values: string[] = [];
  for (let i = 0; i < count; i += 1) {
    values.push((await locator.nth(i).innerText()).trim());
  }
  return values;
}

export async function probeSelector(
  page: Page,
  field: string,
  selector: string | null
): Promise<{ field: string; selector: string | null; resolved: boolean; sample?: string }> {
  if (!selector) return { field, selector, resolved: false };
  try {
    const locator = page.locator(selector).first();
    const count = await page.locator(selector).count();
    if (count === 0) return { field, selector, resolved: false };
    const sample = (await locator.innerText().catch(() => "")).trim().slice(0, 120);
    return { field, selector, resolved: true, sample: sample || undefined };
  } catch {
    return { field, selector, resolved: false };
  }
}
