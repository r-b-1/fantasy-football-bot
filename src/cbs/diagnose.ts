import { loadLeagueConfig } from "../config/load.js";
import {
  allSelectorFields,
  loadSelectorConfig,
  REQUIRED_READ_SELECTOR_FIELDS,
  requiredClickSelectors,
  requiredReadSelectors,
  resolveMockSelectorConfigPath,
  resolveSelectorConfigPath
} from "./selectors.js";
import { probeSelector } from "./locators.js";
import {
  closeSession,
  openAllowlistedUrl,
  openCBSSession,
  openLoggedInDraftRoom,
  resolveCbsBrowserProfileDir,
  summarizeAccessibility,
  waitForPublicMockDraftRoom,
  waitUntilMockPlayerPopupOpen,
  waitUntilMockYouAreUp
} from "./session.js";
import { persistMockDraftStartUrl, resolveMockDraftStartUrl } from "./mockStartUrl.js";
import {
  isAllInTheFamilyHost,
  isAllowedCbsUrl,
  leagueStartUrl,
  looksLikeCbsDraftRoom
} from "./allowlist.js";
import { inspectDraftRoom, writeDiagnoseDump } from "./inspect.js";
import { parseListedTeamCount, parseScoringFormat } from "./roomFacts.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

async function openMockDiagnoseRoom(
  profileDir: string,
  startUrl: string
): Promise<Awaited<ReturnType<typeof openLoggedInDraftRoom>>> {
  const session = await openCBSSession(profileDir);
  try {
    await openAllowlistedUrl(session.page, startUrl);
    console.log(`Opened ${session.page.url()}`);
    console.log("Join a public mock yourself in this Chrome window. This program will not click Join.");
    console.log("Waiting until that room is open and YOU ARE ON THE CLOCK. Leave this terminal running.");
    const focused = await waitForPublicMockDraftRoom(session);
    return { session, focused };
  } catch (error) {
    await closeSession(session);
    throw error;
  }
}

export async function runCbsDiagnose(options: { mock?: boolean } = {}): Promise<void> {
  const mock = options.mock ?? false;
  const selectorPath = mock
    ? resolveMockSelectorConfigPath()
    : resolveSelectorConfigPath();
  const league = loadLeagueConfig(
    mock
      ? (process.env.CBS_MOCK_LEAGUE_CONFIG ?? "config/league.mock.json")
      : (process.env.LEAGUE_CONFIG ?? "config/league.current.json")
  );
  const selectors = loadSelectorConfig(selectorPath);
  if (selectors.kind === "fixture") {
    console.error("This command opens live CBS. Use `npm run cbs:fixture` for the local fake room.");
    process.exitCode = 2;
    return;
  }
  const profileDir = resolveCbsBrowserProfileDir(mock ? "mock" : "live");
  const startUrl = mock ? resolveMockDraftStartUrl() : leagueStartUrl(selectors.draftRoomUrlPattern);

  console.log(`League: ${league.leagueName} / ${league.userTeamName}`);
  console.log(`Selector config: ${selectorPath} (${selectors.status})`);
  console.log(mock ? "Mode: public CBS mock diagnose (no clicks)." : "Mode: league draft-room diagnose (no clicks).");
  console.log("Opening a visible Chrome window with a local persistent profile.");
  console.log(`Chrome profile: ${profileDir}`);
  if (mock) console.log(`Mock start URL: ${startUrl}`);
  console.log("Log into CBS yourself. This program will not ask for or store credentials.");

  let { session, focused } = mock
    ? await openMockDiagnoseRoom(profileDir, startUrl)
    : await openLoggedInDraftRoom({
        profileDir,
        startUrl,
        preferredPattern: selectors.draftRoomUrlPattern,
        prompt:
          "Click Draft Room even if it opens a new window. Wait until pick/clock are visible, then press Enter here.\nDo not press Enter on League Feed.\n"
      });

  try {
    if (mock) {
      const remembered = persistMockDraftStartUrl(focused.page.url());
      console.log(`Remembered ${remembered} for the next mock command.`);
      focused = await waitUntilMockYouAreUp(session, selectors);
      persistMockDraftStartUrl(focused.page.url());
      focused = await waitUntilMockPlayerPopupOpen(session);
      persistMockDraftStartUrl(focused.page.url());
    }
    console.log(`Open windows (${focused.urls.length}):`);
    for (const openUrl of focused.urls) {
      console.log(`  ${openUrl}`);
    }

    const url = focused.page.url();
    console.log(`Using: ${url}`);
    console.log(`Current URL allowed: ${isAllowedCbsUrl(url)}`);
    if (mock && isAllInTheFamilyHost(url)) {
      console.error("\nDiagnose --mock refused the real All in the Family draft room.");
      process.exitCode = 2;
      return;
    }
    if (!looksLikeCbsDraftRoom(url)) {
      console.error("\nThis page is not a CBS draft room.");
      if (mock) {
        console.error("Join a public mock and leave that window open, then re-run diagnose --mock.");
      } else {
        console.error("Click Draft / Drafts → Draft Room in the Chrome window this command opened.");
        console.error("If a popup appears, leave it open, then press Enter here. Diagnose will attach to that window.");
        console.error("Do not start a fake draft inside the real All in the Family league.");
      }
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
      if (
        !probe.resolved &&
        (REQUIRED_READ_SELECTOR_FIELDS as readonly string[]).includes(field)
      ) {
        unresolvedRequired.push(field);
      }
    }
    const haystack = ((await focused.page.evaluate(
      `(() => (document.body ? document.body.innerText || "" : "").replace(/\\s+/g, " "))()`
    )) as string).slice(0, 8000);
    const scoring = parseScoringFormat(haystack);
    const listedTeamCount = parseListedTeamCount(haystack);
    const clickMissing = requiredClickSelectors(selectors);
    console.log(
      `\nVisible room facts: scoring=${scoring ? `${scoring.format} (${scoring.raw})` : "unresolved"} teamCount=${listedTeamCount ?? "unresolved"}`
    );
    if (mock) {
      mkdirSync(".local", { recursive: true });
      writeFileSync(
        join(".local", "mock-room-facts.json"),
        `${JSON.stringify(
          {
            capturedAt: new Date().toISOString(),
            url,
            scoring,
            listedTeamCount,
            clickMissing,
            haystackPreview: haystack.slice(0, 1500)
          },
          null,
          2
        )}\n`
      );
      console.log("Wrote visible scoring/team-count copy to .local/mock-room-facts.json");
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
    if (mock) {
      console.log("You can run `npm run cbs:mock` next (recommend only, no clicks).");
      if (clickMissing.length > 0) {
        console.log(
          `Click locators still unset (${clickMissing.join(", ")}). Capture them from the dump while YOU ARE ON THE CLOCK with the Draft button visible, then save to config/selectors.local.json. Do not guess.`
        );
      } else {
        console.log("Click locators resolved. You can run `npm run cbs:mock-confirm`.");
      }
    } else {
      console.log("You can run `npm run cbs:monitor` or `npm run cbs:recommend` next (no clicks).");
    }
    console.log("Draft/search/confirm locators stay unset until those controls are visible.");
  } finally {
    await session.context.close();
  }
}
