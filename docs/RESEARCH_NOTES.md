# Research Notes and Primary References

Research date: August 13, 2026.

These references informed the architecture. Re-check them before major upgrades because APIs/UI behavior can change.

## OpenAI

### Responses / model guidance

- https://developers.openai.com/api/docs
- https://developers.openai.com/api/docs/guides/reasoning
- https://developers.openai.com/api/docs/guides/structured-outputs

Current OpenAI documentation recommends the Responses API for reasoning workflows. Structured Outputs can enforce a supplied schema. The current docs recommend starting with `gpt-5.6` for reasoning workloads, with configurable reasoning effort/mode.

### Computer use

- https://developers.openai.com/api/docs/guides/tools-computer-use

OpenAI documents computer-use harnesses and explicitly recommends isolated environments, domain/action constraints, and human involvement for authenticated or difficult-to-reverse actions. This is one reason the project uses deterministic Playwright for the pick executor and uses the model primarily as a bounded decision layer.

## Playwright

- https://playwright.dev/docs/locators
- https://playwright.dev/docs/best-practices
- https://playwright.dev/docs/getting-started-mcp

Playwright recommends resilient locators such as role/text/label-based locators, and its MCP server is documented as compatible with Cursor. Use MCP/codegen to discover the real CBS selectors instead of guessing from screenshots.

## CBS Fantasy Football

- https://help.football.cbssports.com/s/article/How-does-Autopilot-work
- https://help.football.cbssports.com/s/article/How-can-I-place-players-into-my-draft-room-queue
- https://help.football.cbssports.com/s/article/How-do-I-avoid-too-many-players-at-a-specific-position-being-drafted-by-autopilot

CBS documents native Autopilot and the Draft Room player queue. The custom tool should treat those as fallback mechanisms.

## Related open-source projects

### jjti/ff

- https://github.com/jjti/ff

This project uses projections and value-over-replacement concepts and explicitly discusses how league size, roster format, scoring, ADP, and other drafters change VOR. The current project borrows the architectural idea of dynamic replacement/scarcity but does not copy code unless license compatibility is reviewed.

### Google Gemini fantasy workshop

- https://github.com/google-gemini/workshops/tree/main/fantasy

Google's workshop demonstrates a Chrome-extension/server fantasy draft companion architecture for Sleeper. It is useful as an example of coupling a live draft UI to an AI assistant.

### Fantasy Football Metrics Weekly Report

- https://github.com/uberfastman/fantasy-football-metrics-weekly-report

This project currently supports CBS for read/report workflows and notes use of an older CBS API that was once publicly documented. It is useful as reference for CBS data access history, but this draft agent should not assume an undocumented draft-write endpoint exists.

## NPM versions observed during research

As of research date:

- `openai` 7.4.0
- `playwright` 1.62.1
- `zod` 4.4.3
- `xlsx` 0.18.5

Pinning is recommended for draft-week stability, then update intentionally after the season.
