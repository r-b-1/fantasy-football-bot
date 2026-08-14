import { ambiguousIdentity, unresolvedIdentity, type EngineError } from "../domain/errors.js";
import type { Position, SportslinePlayer } from "../domain/types.js";
import { dstNameCandidates, normalizePlayerName, playerKey } from "../data/normalize.js";

export type IdentityResult =
  | { ok: true; player: SportslinePlayer }
  | { ok: false; error: EngineError };

export function resolvePlayer(
  players: SportslinePlayer[],
  name: string,
  position?: Position
): IdentityResult {
  if (position) {
    const exact = players.find((p) => p.id === playerKey(name, position));
    if (exact) return { ok: true, player: exact };

    if (position === "DST") {
      const aliases = new Set(dstNameCandidates(name).map((alias) => playerKey(alias, "DST")));
      const dstMatches = players.filter((p) => p.position === "DST" && aliases.has(p.id));
      if (dstMatches.length === 1) return { ok: true, player: dstMatches[0]! };
      if (dstMatches.length > 1) {
        return {
          ok: false,
          error: ambiguousIdentity(
            name,
            dstMatches.map((p) => p.id)
          )
        };
      }
    }
    return { ok: false, error: unresolvedIdentity(name, position) };
  }

  const normalized = normalizePlayerName(name).toLowerCase();
  const matches = players.filter((p) => p.name.toLowerCase() === normalized);
  if (matches.length === 1) return { ok: true, player: matches[0]! };
  if (matches.length > 1) {
    return { ok: false, error: ambiguousIdentity(name, matches.map((p) => p.id)) };
  }

  const dstMatches = players.filter((p) => {
    if (p.position !== "DST") return false;
    return dstNameCandidates(name).some(
      (alias) => playerKey(alias, "DST") === p.id
    );
  });
  if (dstMatches.length === 1) return { ok: true, player: dstMatches[0]! };
  if (dstMatches.length > 1) {
    return { ok: false, error: ambiguousIdentity(name, dstMatches.map((p) => p.id)) };
  }

  return { ok: false, error: unresolvedIdentity(name) };
}

export function requirePlayer(
  players: SportslinePlayer[],
  name: string,
  position?: Position
): SportslinePlayer {
  const result = resolvePlayer(players, name, position);
  if (!result.ok) throw result.error;
  return result.player;
}
