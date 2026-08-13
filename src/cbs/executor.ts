import type { Page } from "playwright";
import type { CandidateScore, DraftState, LeagueConfig, StrategyConfig } from "../domain/types.js";
import type { SelectorConfig } from "./selectors.js";

export class CBSExecutor {
  constructor(
    private readonly page: Page,
    private readonly selectors: SelectorConfig,
    private readonly league: LeagueConfig,
    private readonly strategy: StrategyConfig
  ) {}

  async executePick(candidate: CandidateScore, state: DraftState): Promise<void> {
    if (!this.league.cbsExecutionEnabled) {
      throw new Error("CBS execution is disabled in league config.");
    }
    if (this.league.executionMode !== "autopilot" && this.league.executionMode !== "confirm") {
      throw new Error(`Execution not allowed in mode ${this.league.executionMode}`);
    }
    if (!state.isUserTurn || state.teamOnClock !== this.league.userTeamName) {
      throw new Error("Safety gate failed: user team is not confirmed on the clock.");
    }
    if (
      state.clockSecondsRemaining !== null &&
      state.clockSecondsRemaining < this.strategy.minimumExecutionClockSeconds
    ) {
      throw new Error("Safety gate failed: insufficient clock time for verified execution.");
    }

    // Phase 5 TODO:
    // 1. Re-read live current pick and user-turn state.
    // 2. Re-read target row and exact identity.
    // 3. Click once.
    // 4. Verify CBS draft result and pick advance.
    // Never implement this from guessed selectors.
    void candidate;
    void this.page;
    void this.selectors;
    throw new Error("CBSExecutor is not enabled until Phase 5 mock-draft validation.");
  }
}
