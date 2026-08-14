import type { Page } from "playwright";
import type { CandidateScore, LeagueConfig, StrategyConfig } from "../domain/types.js";
import { appendEvent } from "../state/eventLog.js";
import { assertAllowedFixtureUrl, isAllowedCbsUrl } from "./allowlist.js";
import { CBSReader } from "./reader.js";
import type { SelectorConfig } from "./selectors.js";

export class FixtureExecutorError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "not_fixture"
      | "disabled"
      | "duplicate"
      | "not_our_turn"
      | "stale_pick"
      | "unavailable"
      | "verification_failed"
      | "clock"
  ) {
    super(message);
    this.name = "FixtureExecutorError";
  }
}

export class FixtureExecutor {
  private readonly completed = new Set<number>();
  private disabled = false;
  private disableReason: string | null = null;

  constructor(
    private readonly page: Page,
    private readonly reader: CBSReader,
    private readonly selectors: SelectorConfig,
    private readonly league: LeagueConfig,
    private readonly strategy: StrategyConfig,
    private readonly logPath?: string
  ) {}

  get isDisabled(): boolean {
    return this.disabled;
  }

  get disableReasonText(): string | null {
    return this.disableReason;
  }

  get completedPicks(): number[] {
    return [...this.completed];
  }

  async executeConfirmedPick(candidate: CandidateScore, expectedOverallPick: number): Promise<void> {
    const url = this.page.url();
    if (isAllowedCbsUrl(url) || this.selectors.kind !== "fixture") {
      throw new FixtureExecutorError("Fixture executor refused a non-fixture/CBS target", "not_fixture");
    }
    assertAllowedFixtureUrl(url);
    if (this.disabled) {
      throw new FixtureExecutorError(
        `Executor disabled after prior failure: ${this.disableReason}`,
        "disabled"
      );
    }
    if (this.completed.has(expectedOverallPick)) {
      throw new FixtureExecutorError(
        `Already successfully completed fixture pick ${expectedOverallPick}`,
        "duplicate"
      );
    }

    const snapshot = await this.reader.readLiveSnapshot([]);
    if (!snapshot.control.isUserTurn || snapshot.control.teamOnClock !== this.league.userTeamName) {
      throw new FixtureExecutorError("Safety gate failed: user team is not on the clock", "not_our_turn");
    }
    if (snapshot.control.currentOverallPick !== expectedOverallPick) {
      throw new FixtureExecutorError(
        `Expected pick ${expectedOverallPick} but page shows ${snapshot.control.currentOverallPick}`,
        "stale_pick"
      );
    }
    if (
      snapshot.control.clockSecondsRemaining !== null &&
      snapshot.control.clockSecondsRemaining < this.strategy.minimumExecutionClockSeconds
    ) {
      throw new FixtureExecutorError("Safety gate failed: insufficient clock time", "clock");
    }
    if (snapshot.results.some((row) => row.playerName === candidate.player.name)) {
      throw new FixtureExecutorError(`${candidate.player.name} is already drafted`, "unavailable");
    }

    const search = this.selectors.selectors.playerSearchInput;
    const draft = this.selectors.selectors.draftAction;
    const confirm = this.selectors.selectors.draftConfirmation;
    if (!search || !draft || !confirm) {
      this.disable("Fixture draft locators are missing");
      throw new FixtureExecutorError("Fixture draft locators are missing", "verification_failed");
    }

    await this.page.waitForFunction(`() => {
      const btn = document.querySelector("[data-testid='draft-action']");
      const input = document.querySelector("[data-testid='player-search']");
      return Boolean(btn && input && !btn.disabled && !input.disabled);
    }`);

    await this.page.locator(search).fill(candidate.player.name);
    await this.page.locator(draft).click();
    const pending = (await this.page.locator("[data-testid='pending-player']").innerText()).trim();
    if (!pending.includes(candidate.player.name)) {
      this.disable(`Pending pick mismatch: ${pending}`);
      throw new FixtureExecutorError("Pending identity did not match target; not confirming", "verification_failed");
    }

    this.log({
      type: "pick_submitted",
      overallPick: expectedOverallPick,
      candidateId: candidate.player.id,
      playerName: candidate.player.name
    });

    await this.page.locator(confirm).click();

    try {
      await this.page.waitForFunction(
        `({ pick, name }) => {
          const rows = [...document.querySelectorAll("[data-testid='draft-result-row']")];
          return rows.some((row) => {
            const pickText = row.querySelector("[data-testid='result-pick']")?.textContent?.trim();
            const playerText = row.querySelector("[data-testid='result-player']")?.textContent?.trim();
            return pickText === String(pick) && playerText === name;
          });
        }`,
        { pick: expectedOverallPick, name: candidate.player.name },
        { timeout: 3000 }
      );
    } catch {
      this.disable("Result verification timed out; not retrying");
      throw new FixtureExecutorError(
        "Verification failed: fake room result did not match the target player",
        "verification_failed"
      );
    }

    const after = await this.reader.readDraftResults();
    const row = after.find((result) => result.overallPick === expectedOverallPick);
    if (
      !row ||
      row.playerName !== candidate.player.name ||
      row.fantasyTeam !== this.league.userTeamName
    ) {
      this.disable("Result verification failed; not retrying");
      throw new FixtureExecutorError(
        "Verification failed: fake room result did not match the target player",
        "verification_failed"
      );
    }

    const advanced = await this.reader.readLiveSnapshot([]);
    if ((advanced.control.currentOverallPick ?? 0) <= expectedOverallPick) {
      this.disable("Pick number did not advance after confirm");
      throw new FixtureExecutorError("Verification failed: overall pick did not advance", "verification_failed");
    }

    this.completed.add(expectedOverallPick);
    this.log({
      type: "pick_verified",
      overallPick: expectedOverallPick,
      candidateId: candidate.player.id,
      playerName: candidate.player.name
    });
  }

  private disable(reason: string): void {
    this.disabled = true;
    this.disableReason = reason;
    this.log({ type: "execution_disabled", reason });
  }

  private log(event: object): void {
    if (!this.logPath) return;
    appendEvent(this.logPath, event);
  }
}
