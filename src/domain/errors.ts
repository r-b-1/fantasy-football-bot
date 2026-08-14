import type { Position } from "./types.js";

export type EngineErrorKind =
  | "no_candidates"
  | "duplicate_player_key"
  | "unresolved_identity"
  | "ambiguous_identity"
  | "config_conflict"
  | "missing_sheet"
  | "missing_headers"
  | "invalid_config"
  | "invalid_fixture";

export class EngineError extends Error {
  readonly kind: EngineErrorKind;
  readonly details: Record<string, unknown>;

  constructor(kind: EngineErrorKind, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "EngineError";
    this.kind = kind;
    this.details = details;
  }
}

export function missingSheet(sheet: string): EngineError {
  return new EngineError("missing_sheet", `Missing SportsLine sheet: ${sheet}`, { sheet });
}

export function missingHeaders(sheet: string, missing: string[]): EngineError {
  return new EngineError(
    "missing_headers",
    `SportsLine sheet ${sheet} is missing required headers: ${missing.join(", ")}`,
    { sheet, missing }
  );
}

export function duplicatePlayerKeys(
  collisions: Array<{ key: string; names: string[] }>
): EngineError {
  const summary = collisions
    .map((c) => `${c.key} (${c.names.join(" vs ")})`)
    .join("; ");
  return new EngineError(
    "duplicate_player_key",
    `Duplicate normalized player keys: ${summary}`,
    { collisions }
  );
}

export function unresolvedIdentity(name: string, position?: Position): EngineError {
  return new EngineError(
    "unresolved_identity",
    `Could not resolve player identity ${name}${position ? ` (${position})` : ""} against SportsLine`,
    { name, position }
  );
}

export function ambiguousIdentity(name: string, matches: string[]): EngineError {
  return new EngineError(
    "ambiguous_identity",
    `Ambiguous player identity ${name}: ${matches.join(", ")}`,
    { name, matches }
  );
}

export function configConflict(conflicts: string[]): EngineError {
  return new EngineError("config_conflict", conflicts.join("\n"), { conflicts });
}

export function noCandidates(): EngineError {
  return new EngineError("no_candidates", "No eligible draft candidates");
}
