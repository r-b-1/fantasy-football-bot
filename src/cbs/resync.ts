import type { DraftPickEvent, SportslinePlayer } from "../domain/types.js";
import { listedPositionFromCbsName, sportslineNameFromCbsListing } from "../data/normalize.js";
import { resolvePlayer } from "../engine/identity.js";
import type { LiveDraftResult } from "./types.js";

function resolveLiveResult(players: SportslinePlayer[], live: LiveDraftResult) {
  const name = sportslineNameFromCbsListing(live.playerName);
  const position = live.position ?? listedPositionFromCbsName(live.playerName);
  return resolvePlayer(players, name, position);
}

export interface ResyncResult {
  events: DraftPickEvent[];
  conflicts: string[];
  needsOperatorReview: boolean;
}

export function resyncFromDraftResults(
  localEvents: DraftPickEvent[],
  liveResults: LiveDraftResult[],
  players: SportslinePlayer[],
  observedAt = new Date().toISOString()
): ResyncResult {
  const conflicts: string[] = [];
  const localByPick = new Map(localEvents.map((event) => [event.overallPick, event]));
  const liveByPick = new Map(liveResults.map((result) => [result.overallPick, result]));
  const events: DraftPickEvent[] = [];

  const picks = [...new Set([...localByPick.keys(), ...liveByPick.keys()])].sort((a, b) => a - b);
  for (const overallPick of picks) {
    const live = liveByPick.get(overallPick);
    const local = localByPick.get(overallPick);

    if (live && !local) {
      const resolved = resolveLiveResult(players, live);
      if (!resolved.ok) {
        conflicts.push(
          `CBS pick ${overallPick} (${live.fantasyTeam} / ${live.playerName}) could not be matched; leaving it for operator review.`
        );
        continue;
      }
      events.push({
        overallPick,
        round: live.round,
        fantasyTeam: live.fantasyTeam,
        playerId: resolved.player.id,
        playerName: resolved.player.name,
        position: resolved.player.position,
        observedAt
      });
      continue;
    }

    if (local && !live) {
      conflicts.push(
        `Local log has pick ${overallPick} (${local.fantasyTeam} / ${local.playerName}) that is not in the CBS draft results. CBS is the live source of truth; operator review required.`
      );
      events.push(local);
      continue;
    }

    if (live && local) {
      const resolved = resolveLiveResult(players, live);
      if (!resolved.ok) {
        conflicts.push(
          `CBS pick ${overallPick} identity is ambiguous (${resolved.error.message}). Keeping local event pending review.`
        );
        events.push(local);
        continue;
      }
      if (local.playerId !== resolved.player.id) {
        conflicts.push(
          `Pick ${overallPick} disagrees: local ${local.playerName} vs CBS ${resolved.player.name}. Operator review required; not silently overwritten.`
        );
        events.push(local);
        continue;
      }
      events.push({
        ...local,
        fantasyTeam: live.fantasyTeam,
        playerName: resolved.player.name,
        position: resolved.player.position,
        round: live.round ?? local.round,
        observedAt
      });
    }
  }

  return {
    events,
    conflicts,
    needsOperatorReview: conflicts.length > 0
  };
}
