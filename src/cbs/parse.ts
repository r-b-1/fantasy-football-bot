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
  const named = parseNamedDurationSeconds(trimmed);
  if (named != null) return named;
  const parts = trimmed.split(":").map((part) => Number(part));
  if (parts.length >= 2 && parts.every((part) => Number.isFinite(part))) {
    if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
    if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
    const [first, second, third] = parts;
    // Live pre-draft clock is days:hours:minutes:seconds when the first value
    // looks like a day count (1:01:45:30). Older room dumps used hours first
    // (25:22:34:52).
    if (first! <= 14 && second! < 24 && third! < 60) {
      return first! * 86400 + second! * 3600 + third! * 60 + Math.floor(parts[3]!);
    }
    return first! * 3600 + second! * 60 + third!;
  }
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) return seconds;
  throw parseFailed("countdownClock", raw);
}

export function parseClockSecondsLenient(raw: string): number | null {
  try {
    return parseClockSeconds(raw);
  } catch {
    return null;
  }
}

export function parseNamedDurationSeconds(raw: string): number | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!/\b(day|hour|minute|second)s?\b/i.test(text)) return null;
  const days = Number(text.match(/(\d+)\s*days?/i)?.[1] ?? 0);
  const hours = Number(text.match(/(\d+)\s*hours?/i)?.[1] ?? 0);
  const minutes = Number(text.match(/(\d+)\s*minutes?/i)?.[1] ?? 0);
  const seconds = Number(text.match(/(\d+)\s*seconds?/i)?.[1] ?? 0);
  const total = days * 86400 + hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? total : null;
}

export function formatClockDuration(total: number | null): string {
  if (total == null) return "";
  const sec = Math.max(0, Math.floor(total));
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (minutes) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  if (!days && (seconds > 0 || parts.length === 0)) {
    parts.push(`${seconds} second${seconds === 1 ? "" : "s"}`);
  }
  return parts.join(" ");
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
