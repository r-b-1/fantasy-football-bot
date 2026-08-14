import { loadLeagueConfig, loadStrategyConfig } from "../config/load.js";
import { loadDraftFixture } from "../data/fixture.js";
import { loadSportslineWorkbook } from "../data/sportsline.js";
import type { DraftFixture } from "../domain/types.js";
import { generateShortlist } from "../engine/shortlist.js";
import { buildDraftStateFromFixture } from "../engine/state.js";
import { formatShortlist } from "./format.js";

export interface ReplayDemoOptions {
  scriptPath: string;
  leaguePath: string;
  strategyPath: string;
  sportslinePath: string;
}

function fixtureAtPick(script: DraftFixture, overallPick: number, userTeamName: string): DraftFixture {
  return {
    ...script,
    name: `${script.name}-at-${overallPick}`,
    currentOverallPick: overallPick,
    teamOnClock: userTeamName,
    drafted: script.drafted.filter((pick) => pick.overallPick < overallPick)
  };
}

export function renderReplayDemo(options: ReplayDemoOptions): string {
  const league = loadLeagueConfig(options.leaguePath);
  const strategy = loadStrategyConfig(options.strategyPath);
  const players = loadSportslineWorkbook(options.sportslinePath);
  const script = loadDraftFixture(options.scriptPath);
  const userPicks = new Set(league.knownOverallPicks);
  const lastPick = Math.max(
    ...script.drafted.map((pick) => pick.overallPick),
    ...league.knownOverallPicks.filter((pick) => pick <= 35)
  );

  const lines: string[] = [
    "=== Pickens My Jeanty — mock draft live demo ===",
    "This is a fixture replay, not the live CBS room. No clicks are performed.",
    `League: ${league.leagueName} / ${league.userTeamName} (slot ${league.draftSlot}, ${league.teamCount} teams, ${league.scoringFormat})`,
    `Keepers off the board: ${script.keepers.map((k) => `${k.name} (${k.fantasyTeam})`).join("; ")}`,
    ""
  ];

  for (let overallPick = 1; overallPick <= lastPick; overallPick += 1) {
    if (userPicks.has(overallPick)) {
      const { state, livePlayers } = buildDraftStateFromFixture(
        players,
        fixtureAtPick(script, overallPick, league.userTeamName),
        league,
        strategy
      );
      const ranked = generateShortlist(livePlayers, state, league, strategy);
      lines.push("------------------------------------------------------------");
      lines.push(`OUR TURN @ ${overallPick}. Engine freeze + deterministic shortlist:`);
      lines.push(formatShortlist(ranked, state, league, { explain: "top" }));
      const top = ranked[0]!;
      lines.push(`Fallback / recommend: ${top.player.name} (${top.player.position}) score ${top.score.toFixed(2)}`);
    }

    const made = script.drafted.find((pick) => pick.overallPick === overallPick);
    if (made) {
      const ours = made.fantasyTeam === league.userTeamName ? "  << our pick" : "";
      lines.push(
        `${String(overallPick).padStart(3)}. ${made.fantasyTeam} — ${made.playerName} ${made.position ?? ""}${ours}`
      );
    }
  }

  lines.push("");
  lines.push("Demo complete. CBS live monitor still needs a logged-in draft room and captured selectors.");
  return lines.join("\n");
}
