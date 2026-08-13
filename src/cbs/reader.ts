import type { Page } from "playwright";
import type { DraftState, LeagueConfig, LivePlayer } from "../domain/types.js";
import type { SelectorConfig } from "./selectors.js";

/**
 * IMPORTANT: This adapter is intentionally not implemented from screenshots.
 * Populate real selectors with Playwright MCP/codegen, then implement each field
 * with web-first assertions and typed parsing.
 */
export class CBSReader {
  constructor(
    private readonly page: Page,
    private readonly selectors: SelectorConfig,
    private readonly league: LeagueConfig
  ) {}

  async assertDraftRoom(): Promise<void> {
    const url = this.page.url();
    if (!url.includes(this.selectors.draftRoomUrlPattern)) {
      throw new Error(`Unexpected CBS URL: ${url}`);
    }
  }

  async readDraftState(): Promise<DraftState> {
    await this.assertDraftRoom();
    throw new Error(
      "CBSReader.readDraftState is a Phase 2 TODO. Inspect the real CBS page with Playwright MCP/codegen first."
    );
  }

  async readAvailablePlayers(): Promise<LivePlayer[]> {
    await this.assertDraftRoom();
    throw new Error(
      "CBSReader.readAvailablePlayers is a Phase 2 TODO. Do not implement with guessed selectors."
    );
  }
}
