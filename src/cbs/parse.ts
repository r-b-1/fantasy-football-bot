import { parseFailed } from "./errors.js";

export function parseOverallPick(raw: string): number {
  const match = raw.replace(/,/g, "").match(/(\d+)/);
  if (!match) throw parseFailed("currentOverallPick", raw);
  const value = Number(match[1]);
  if (!Number.isInteger(value) || value <= 0) throw parseFailed("currentOverallPick", raw);
  return value;
}

export function parseOverallPickLenient(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/waiting for start/i.test(trimmed)) return null;
  if (!/\d/.test(trimmed)) return null;
  try {
    return parseOverallPick(trimmed);
  } catch {
    return null;
  }
}

export function parseClockSeconds(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":").map((part) => Number(part));
  if (parts.length >= 2 && parts.every((part) => Number.isFinite(part))) {
    if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
    if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
    // Observed live pre-draft timer: 25:22:34:52 (hours:minutes:seconds:fraction).
    return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  }
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) return seconds;
  throw parseFailed("countdownClock", raw);
}

export function formatClockSeconds(total: number | null): string {
  if (total == null) return "n/a";
  const sec = Math.max(0, Math.floor(total));
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatOnClockStatus(teamOnClock: string | null, isUserTurn: boolean): string {
  const team = (teamOnClock ?? "unknown").trim();
  if (/waiting for start/i.test(team)) return "draft has not started";
  if (isUserTurn) return `${team} is the user`;
  return `${team} is on the clock`;
}

/** "YOU ARE UP IN 2 PICKS" is not the user's turn. */
export function interpretYouAreUp(raw: string): boolean {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!/you are up/i.test(text)) return false;
  if (/you are up in \d+\s+picks?/i.test(text)) return false;
  return true;
}
