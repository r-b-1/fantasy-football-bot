import type { LeagueConfig, Position } from "../domain/types.js";
import type { LiveLeagueFacts } from "./types.js";

function keeperKey(keeper: { name: string; position: Position }): string {
  return `${keeper.name.trim().toLowerCase()}::${keeper.position}`;
}

export function detectConfigConflicts(facts: LiveLeagueFacts, league: LeagueConfig): string[] {
  const conflicts: string[] = [];

  if (facts.teamCount != null && facts.teamCount !== league.teamCount) {
    conflicts.push(
      `Live CBS team count is ${facts.teamCount}, but config/league.current.json has ${league.teamCount}. Update the config explicitly after verifying CBS.`
    );
  }

  if (facts.draftType && facts.draftType !== league.draftType) {
    conflicts.push(
      `Live CBS draft type is ${facts.draftType}, but config has ${league.draftType}. Update the config explicitly after verifying CBS.`
    );
  }

  if (facts.userTeamName && facts.userTeamName !== league.userTeamName) {
    conflicts.push(
      `Live CBS user team is "${facts.userTeamName}", but config has "${league.userTeamName}". Update the config explicitly.`
    );
  }

  if (facts.lineup) {
    for (const [position, liveCount] of Object.entries(facts.lineup) as Array<[Position, number | undefined]>) {
      if (liveCount == null) continue;
      const configured = league.lineup[position];
      if (configured !== liveCount) {
        conflicts.push(
          `Live CBS lineup ${position}=${liveCount} contradicts config ${position}=${configured}. Update the config explicitly.`
        );
      }
    }
  }

  if (facts.userKeepers) {
    const live = new Set(facts.userKeepers.map(keeperKey));
    const configured = new Set(league.keepers.map(keeperKey));
    if (live.size !== configured.size || [...live].some((key) => !configured.has(key))) {
      conflicts.push(
        `Live CBS user keepers (${facts.userKeepers.map((k) => k.name).join(", ") || "none"}) contradict config (${league.keepers.map((k) => k.name).join(", ")}). Update the config explicitly after keeper lock verification.`
      );
    }
  }

  if (facts.userOverallPicks && facts.userOverallPicks.length > 0) {
    const known = new Set(league.knownOverallPicks);
    const extras = facts.userOverallPicks.filter((pick) => !known.has(pick));
    if (extras.length > 0) {
      conflicts.push(
        `Live CBS user picks ${extras.join(", ")} are not in knownOverallPicks. The live source must be copied into config explicitly; knownPicksArePartial=${league.knownPicksArePartial}.`
      );
    }
  }

  return conflicts;
}
