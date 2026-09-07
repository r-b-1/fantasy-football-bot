import type { Position } from "../domain/types.js";

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
