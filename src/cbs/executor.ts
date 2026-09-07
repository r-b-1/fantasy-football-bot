import type { Page } from "playwright";
import type { CandidateScore, DraftState, LeagueConfig, StrategyConfig } from "../domain/types.js";
import { appendEvent } from "../state/eventLog.js";
import { performConfiguredPickClicks } from "./configuredClicks.js";
import { playerNamesEquivalent } from "./parse.js";
import {
  clickLocatorBlock,
  configExecutionBlock,
  hostExecutionBlock,
  snapshotExecutionBlock
} from "./executionGates.js";
import { CBSReader } from "./reader.js";
import type { SelectorConfig } from "./selectors.js";

export class CBSExecutorError extends Error {
  constructor(
    message: string,
    readonly kind: string
  ) {
    super(message);
    this.name = "CBSExecutorError";
  }
}

export class CBSExecutor {
  private readonly completed = new Set<number>();
  private disabled = false;
  private disableReason: string | null = null;

  constructor(
    private readonly page: Page,
    private readonly selectors: SelectorConfig,
    private league: LeagueConfig,
    private readonly strategy: StrategyConfig,
    private readonly reader?: CBSReader,
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

  updateLeague(league: LeagueConfig): void {
    this.league = league;
  }

  async executePick(candidate: CandidateScore, state: DraftState): Promise<void> {
    this.assertHostAndConfig();
    const clockBlock = snapshotExecutionBlock({
      isUserTurn: state.isUserTurn,
      teamOnClock: state.teamOnClock,
      userTeamName: this.league.userTeamName,
      currentOverallPick: state.currentOverallPick,
      expectedOverallPick: state.currentOverallPick,
      clockSecondsRemaining: state.clockSecondsRemaining,
      minimumExecutionClockSeconds: this.strategy.minimumExecutionClockSeconds,
      results: state.draftEvents.map((event) => ({
        overallPick: event.overallPick,
        fantasyTeam: event.fantasyTeam,
        playerName: event.playerName
      })),
      playerName: candidate.player.name,
      completed: this.completed,
      disabledReason: this.disableReason
    });
    if (clockBlock) throw new CBSExecutorError(clockBlock.message, clockBlock.kind);
    await this.executeConfirmedPick(candidate, state.currentOverallPick);
  }

  async executeConfirmedPick(candidate: CandidateScore, expectedOverallPick: number): Promise<void> {
    this.assertHostAndConfig();
    const locatorBlock = clickLocatorBlock(this.selectors);
    if (locatorBlock) {
      this.disable(locatorBlock.message);
      throw new CBSExecutorError(locatorBlock.message, locatorBlock.kind);
    }
    if (!this.reader) {
      throw new CBSExecutorError("CBSExecutor requires a reader for a fresh snapshot.", "stale_pick");
    }

    const snapshot = await this.reader.readLiveSnapshot([]);
    const gate = snapshotExecutionBlock({
      isUserTurn: snapshot.control.isUserTurn,
      teamOnClock: snapshot.control.teamOnClock,
      userTeamName: this.league.userTeamName,
      currentOverallPick: snapshot.control.currentOverallPick,
      expectedOverallPick,
      clockSecondsRemaining: snapshot.control.clockSecondsRemaining,
      minimumExecutionClockSeconds: this.strategy.minimumExecutionClockSeconds,
      results: snapshot.results,
      playerName: candidate.player.name,
      completed: this.completed,
      disabledReason: this.disableReason
    });
    if (gate) {
      if (gate.kind === "disabled" || gate.kind === "duplicate") {
        throw new CBSExecutorError(gate.message, gate.kind);
      }
      throw new CBSExecutorError(gate.message, gate.kind);
    }

    this.log({
      type: "pick_submitted",
      overallPick: expectedOverallPick,
      candidateId: candidate.player.id,
      playerName: candidate.player.name
    });

    try {
      await performConfiguredPickClicks(this.page, this.selectors.selectors, candidate.player.name);
    } catch (error) {
      this.disable(error instanceof Error ? error.message : String(error));
      throw new CBSExecutorError(
        error instanceof Error ? error.message : String(error),
        "verification_failed"
      );
    }

    const verified = await this.verifyPick(candidate.player.name, expectedOverallPick);
    if (!verified) {
      this.disable("Result verification failed; not retrying");
      throw new CBSExecutorError(
        "Verification failed: mock draft result did not match the target player",
        "verification_failed"
      );
    }

    this.completed.add(expectedOverallPick);
    this.log({
      type: "pick_verified",
      overallPick: expectedOverallPick,
      candidateId: candidate.player.id,
      playerName: candidate.player.name
    });
  }

  private assertHostAndConfig(): void {
    const host = hostExecutionBlock(this.page.url());
    if (host) throw new CBSExecutorError(host.message, host.kind);
    const config = configExecutionBlock(this.league);
    if (config) throw new CBSExecutorError(config.message, config.kind);
    if (this.selectors.kind === "fixture") {
      throw new CBSExecutorError(
        "CBSExecutor will not act on the local fake room or any non-CBS page.",
        "fixture"
      );
    }
  }

  private async verifyPick(playerName: string, expectedOverallPick: number): Promise<boolean> {
    if (!this.reader) return false;
    const started = Date.now();
    while (Date.now() - started < 8000) {
      const after = await this.reader.readDraftResults();
      const row = after.find((result) => result.overallPick === expectedOverallPick);
      if (
        row &&
        playerNamesEquivalent(row.playerName, playerName) &&
        row.fantasyTeam === this.league.userTeamName
      ) {
        const advanced = await this.reader.readLiveSnapshot([]);
        if ((advanced.control.currentOverallPick ?? 0) > expectedOverallPick) return true;
      }
      await this.page.waitForTimeout(200);
    }
    return false;
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
