import { loadLeagueConfig } from "../config/load.js";
import { allSelectorFields, loadSelectorConfig, requiredReadSelectors, resolveSelectorConfigPath } from "./selectors.js";
import { probeSelector } from "./locators.js";
import {
  focusDraftRoomPage,
  openAllowlistedCbsPage,
  openCBSSession,
  summarizeAccessibility,
  waitForManualLogin
} from "./session.js";
import { isAllowedCbsUrl, looksLikeCbsDraftRoom } from "./allowlist.js";
import { inspectDraftRoom, writeDiagnoseDump } from "./inspect.js";

export async function runCbsDiagnose(): Promise<void> {
  const selectorPath = resolveSelectorConfigPath();
  const league = loadLeagueConfig(process.env.LEAGUE_CONFIG ?? "config/league.current.json");
  const selectors = loadSelectorConfig(selectorPath);
  if (selectors.kind === "fixture") {
    console.error("This command opens live CBS. Use `npm run cbs:fixture` for the local fake room.");
    process.exitCode = 2;
    return;
  }
  const profileDir = process.env.CBS_BROWSER_PROFILE_DIR ?? ".local/cbs-browser-profile";

  console.log(`League: ${league.leagueName} / ${league.userTeamName}`);
  console.log(`Selector config: ${selectorPath} (${selectors.status})`);
  console.log("Opening a visible Chrome window with a local persistent profile.");
  console.log("Log into CBS yourself. This program will not ask for or store credentials.");

  const session = await openCBSSession(profileDir);
  try {
    await openAllowlistedCbsPage(session.page, selectors.draftRoomUrlPattern);
    await waitForManualLogin(
      "Click Draft Room even if it opens a new window. Wait until pick/clock are visible, then press Enter here.\nDo not press Enter on League Feed.\n"
    );

    const focused = await focusDraftRoomPage(session, selectors.draftRoomUrlPattern);
    console.log(`Open windows (${focused.urls.length}):`);
    for (const openUrl of focused.urls) {
      console.log(`  ${openUrl}`);
    }

    const url = focused.page.url();
    console.log(`Using: ${url}`);
    console.log(`Current URL allowed: ${isAllowedCbsUrl(url)}`);
    if (!looksLikeCbsDraftRoom(url)) {
      console.error("\nThis page is not a CBS draft room.");
      console.error("Click Draft / Drafts → Draft Room in the Chrome window this command opened.");
      console.error("If a popup appears, leave it open, then press Enter here. Diagnose will attach to that window.");
      console.error("Do not start a fake draft inside the real All in the Family league.");
      process.exitCode = 2;
      return;
    }
    for (const line of await summarizeAccessibility(focused.page)) {
      console.log(line);
    }

    const dump = await inspectDraftRoom(focused.page);
    for (const line of dump.lines) console.log(line);
    const dumpPath = writeDiagnoseDump(dump.lines, dump.frames);
    console.log(`\nWrote frame dump to ${dumpPath}`);

    console.log("\nSelector probe (null means not configured; unresolved means the saved locator missed):");
    const missing = requiredReadSelectors(selectors);
    const unresolvedRequired: string[] = [];
    for (const [field, selector] of allSelectorFields(selectors)) {
      const probe = await probeSelector(focused.page, field, selector);
      console.log(
        `  ${probe.field}: ${probe.resolved ? "RESOLVED" : "NOT RESOLVED"} ${probe.selector ?? "null"}${probe.sample ? ` => ${JSON.stringify(probe.sample)}` : ""}`
      );
      if (!probe.resolved && missing.includes(field)) {
        unresolvedRequired.push(field);
      }
    }
    if (selectors.status.startsWith("UNCONFIGURED") || missing.length > 0 || unresolvedRequired.length > 0) {
      console.log("\nRead-only monitor cannot start yet.");
      console.log("Do not guess selectors from screenshots.");
      if (missing.length > 0) console.log(`Still missing: ${missing.join(", ")}`);
      if (unresolvedRequired.length > 0) console.log(`Required locators missed the live DOM: ${unresolvedRequired.join(", ")}`);
      process.exitCode = 2;
      return;
    }

    console.log("\nRequired read selectors resolved on the live draft room.");
    console.log("You can run `npm run cbs:monitor` next (read-only, no clicks).");
    console.log("Draft/search/confirm locators are still unset until those controls are visible.");
  } finally {
    await session.context.close();
  }
}
