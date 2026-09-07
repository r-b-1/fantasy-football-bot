import { POSITIONS, type Position } from "../domain/types.js";

const APOSTROPHES = /[’‘‛ʻʹ`]/g;

export function normalizeHeader(value: string): string {
  return value.replace(/\s+/g, " ").trim().toUpperCase();
}

export function normalizeTeamName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(APOSTROPHES, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function teamNameKey(name: string): string {
  return normalizeTeamName(name).toLowerCase();
}

export function normalizePlayerName(name: string, position?: Position): string {
  let normalized = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(APOSTROPHES, "'")
    .replace(/\s+/g, " ")
    .trim();

  if (position === "DST") {
    normalized = normalized
      .replace(/^(the)\s+/i, "")
      .replace(/\s+(dst|d\/st|defense|defence)$/i, "")
      .trim();
  }

  return normalized;
}

export function playerKey(name: string, position: Position): string {
  return `${normalizePlayerName(name, position).toLowerCase()}::${position}`;
}

export function dstNameCandidates(name: string): string[] {
  const normalized = normalizePlayerName(name, "DST");
  const parts = normalized.split(" ").filter(Boolean);
  const last = parts[parts.length - 1] ?? normalized;
  return [...new Set([normalized, last])];
}

const NAME_SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;

/** Result cells look like "*Irving, Bucky (RB TB)" or "Flowers, Zay (WR BAL)". */
export function stripCbsPlayerDecorations(name: string): string {
  return name
    .replace(/^\*+/, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** CBS player-pool rows use "Hall, Breece"; SportsLine uses "Breece Hall". */
export function toCbsLastFirst(name: string): string {
  const cleaned = name.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.includes(",")) return cleaned;
  const parts = cleaned.split(" ");
  if (parts.length < 2) return cleaned;
  let suffixCount = 0;
  while (suffixCount < parts.length - 1 && NAME_SUFFIX.test(parts[parts.length - 1 - suffixCount]!)) {
    suffixCount += 1;
  }
  const lastStart = parts.length - 1 - suffixCount;
  if (lastStart <= 0) return cleaned;
  const last = parts.slice(lastStart).join(" ");
  const first = parts.slice(0, lastStart).join(" ");
  return `${last}, ${first}`;
}

export function fromCbsLastFirst(name: string): string {
  const cleaned = name.replace(/\s+/g, " ").trim();
  const comma = cleaned.indexOf(",");
  if (comma < 0) return cleaned;
  const last = cleaned.slice(0, comma).trim();
  const first = cleaned.slice(comma + 1).trim();
  if (!last || !first) return cleaned;
  return `${first} ${last}`;
}

export function sportslineNameFromCbsListing(name: string): string {
  return fromCbsLastFirst(stripCbsPlayerDecorations(name));
}

export function listedPositionFromCbsName(name: string): Position | undefined {
  const match = name.match(/\((QB|RB|WR|TE|K|DST|DEF)\b/i);
  if (!match) return undefined;
  const raw = match[1]!.toUpperCase();
  const position = raw === "DEF" ? "DST" : raw;
  return (POSITIONS as readonly string[]).includes(position) ? (position as Position) : undefined;
}

export function playerNamesEquivalent(left: string, right: string): boolean {
  const a = stripCbsPlayerDecorations(left);
  const b = stripCbsPlayerDecorations(right);
  if (!a || !b) return false;
  if (a.toLowerCase() === b.toLowerCase()) return true;
  const aFirst = fromCbsLastFirst(a).toLowerCase();
  const bFirst = fromCbsLastFirst(b).toLowerCase();
  if (aFirst === bFirst) return true;
  return toCbsLastFirst(a).toLowerCase() === toCbsLastFirst(b).toLowerCase();
}

export function cbsPlayerRowMatchTexts(name: string): string[] {
  const trimmed = name.replace(/\s+/g, " ").trim();
  const lastFirst = toCbsLastFirst(sportslineNameFromCbsListing(trimmed));
  return [...new Set([lastFirst, sportslineNameFromCbsListing(trimmed), trimmed].filter(Boolean))];
}
