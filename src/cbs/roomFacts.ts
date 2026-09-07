import { snakeDraftSlot } from "../engine/state.js";
import { teamNameKey } from "../data/normalize.js";
import type { LeagueConfig } from "../domain/types.js";

export interface TeamListNode {
  alt?: string | null;
  title?: string | null;
  ariaLabel?: string | null;
  text?: string | null;
}

const TEAM_LABEL_NOISE =
  /^(you are up(?: in \d+\s+picks?)?|waiting for start|on the clock|turn on autopilot|show taken players|draft help|latest results|pick|team|player)$/i;

export function stripOwnerSuffix(name: string): string {
  return name.replace(/\s*\([^)]+\)\s*$/u, "").trim();
}

export function cleanTeamLabel(raw: string | null | undefined): string | null {
  const text = stripOwnerSuffix((raw ?? "").replace(/\s+/g, " ").trim());
  if (!text) return null;
  if (TEAM_LABEL_NOISE.test(text)) return null;
  if (text.length < 2 || /^[a-z0-9]$/i.test(text)) return null;
  if (/^(<|>|•|you are up)/i.test(text)) return null;
  return text.replace(/\s+logo$/i, "").trim() || null;
}

export function parseTeamLabels(nodes: TeamListNode[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const label =
      cleanTeamLabel(node.ariaLabel) ??
      cleanTeamLabel(node.title) ??
      cleanTeamLabel(node.alt) ??
      cleanTeamLabel(node.text);
    if (!label) continue;
    const key = teamNameKey(label);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(label);
  }
  return names;
}

export function mergeDraftOrder(previous: string[], incoming: string[]): string[] {
  if (incoming.length === 0) return previous;
  if (previous.length === 0) return incoming;
  const merged = [...previous];
  const seen = new Set(previous.map((name) => teamNameKey(stripOwnerSuffix(name))));
  for (const name of incoming) {
    const key = teamNameKey(stripOwnerSuffix(name));
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(name);
  }
  return merged;
}

export function canonicalizeDraftOrder(
  names: string[],
  teamIndex: Map<string, string>
): string[] {
  return names.map((name) => {
    const stripped = stripOwnerSuffix(name);
    return teamIndex.get(teamNameKey(stripped)) ?? stripped;
  });
}

export function ownerFromDraftOrder(
  order: string[],
  overallPick: number,
  teamCount: number
): string | null {
  if (order.length === 0 || overallPick < 1) return null;
  if (order.length === teamCount) {
    return order[snakeDraftSlot(overallPick, teamCount) - 1] ?? null;
  }
  if (overallPick <= order.length) return order[overallPick - 1] ?? null;
  return null;
}

export function parsePickIntervalSeconds(raw: string): number | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const labeled = text.match(
    /(?:time\s+between\s+picks|time\s+per\s+pick|pick\s+timer|between\s+picks)\s*[:\-]?\s*(.+)$/i
  );
  const candidate = (labeled?.[1] ?? text).trim();
  const named = candidate.match(
    /(?:(\d+)\s*h(?:ours?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?\s*(?:(\d+)\s*s(?:ec(?:ond)?s?)?)?/i
  );
  if (named && (named[1] || named[2] || named[3]) && /h|min|sec/i.test(candidate)) {
    const hours = Number(named[1] ?? 0);
    const minutes = Number(named[2] ?? 0);
    const seconds = Number(named[3] ?? 0);
    const total = hours * 3600 + minutes * 60 + seconds;
    if (total > 0) return total;
  }
  const clock = candidate.match(/^(\d+):(\d{1,2})$/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const secondsOnly = candidate.match(/^(\d+)\s*(?:seconds?)?$/i);
  if (secondsOnly) return Number(secondsOnly[1]);
  return null;
}

export function extractPickIntervalRaw(haystack: string): string | null {
  const text = haystack.replace(/\s+/g, " ").trim();
  const match = text.match(
    /((?:time\s+between\s+picks|time\s+per\s+pick|pick\s+timer)\s*[:\-]?\s*(?:\d+:\d{1,2}|\d+(?:\s*(?:seconds?|minutes?|hours?))?)|\d+\s*seconds?\s+between\s+picks)/i
  );
  return match?.[1]?.trim() ?? null;
}

export function formatPickInterval(seconds: number | null, raw?: string | null): string {
  if (seconds == null) return raw?.trim() ?? "";
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  const parts: string[] = [];
  if (minutes) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  if (remain || parts.length === 0) parts.push(`${remain} second${remain === 1 ? "" : "s"}`);
  return `${parts.join(" ")} between picks`;
}

export function isWaitingToStart(teamOnClock: string | null, currentOverallPick: number | null): boolean {
  if (/waiting for start/i.test(teamOnClock ?? "")) return true;
  return currentOverallPick == null && /waiting/i.test(teamOnClock ?? "");
}

export type DetectedScoringFormat = "PPR" | "HALF_PPR" | "NON_PPR";

export function parseScoringFormat(haystack: string): { format: DetectedScoringFormat; raw: string } | null {
  const text = haystack.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const joinNowCount = (text.match(/join now/gi) ?? []).length;
  if (joinNowCount > 1) return null;
  const half = text.match(/half(?:\s*|-)?ppr/i);
  if (half) return { format: "HALF_PPR", raw: half[0] };
  const pprLabeled = text.match(/ppr\s*[-–]\s*(?:standard|flex)\s+roster/i);
  if (pprLabeled) return { format: "PPR", raw: pprLabeled[0] };
  if (/\bppr\b/i.test(text) && !/non[-\s]?ppr/i.test(text)) {
    return { format: "PPR", raw: "PPR" };
  }
  const standard = text.match(/\b(?:non[-\s]?ppr|standard roster|flex roster)\b/i);
  if (standard) return { format: "NON_PPR", raw: standard[0] };
  return null;
}

export function parseListedTeamCount(haystack: string): number | null {
  const text = haystack.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const joinNowCount = (text.match(/join now/gi) ?? []).length;
  if (joinNowCount > 1) return null;
  const labeled = text.match(/\b(\d{1,2})\s*-?\s*teams?\b/i);
  if (labeled) {
    const count = Number(labeled[1]);
    if (count >= 8 && count <= 16) return count;
  }
  const ofCounts = [...text.matchAll(/\bof\s+(\d{1,2})\b/gi)].map((match) => Number(match[1]));
  const unique = [...new Set(ofCounts.filter((count) => count >= 8 && count <= 16))];
  if (unique.length === 1) return unique[0] ?? null;
  return null;
}

export function applyMockRoomFacts(
  league: LeagueConfig,
  input: { draftOrder: string[]; haystack: string }
): { league: LeagueConfig; conflicts: string[] } {
  const conflicts: string[] = [];
  const scoring = parseScoringFormat(input.haystack);
  const listed = parseListedTeamCount(input.haystack);
  const walked = input.draftOrder.length;
  let teamCount = league.teamCount;
  if (listed != null) teamCount = listed;
  else if ([8, 10, 12, 14, 16].includes(walked)) teamCount = walked;

  const scoringFormat = scoring?.format ?? league.scoringFormat;
  if (scoring && scoring.format !== "PPR") {
    conflicts.push(
      `This mock looks like ${scoring.format} (${scoring.raw}). The SportsLine sheet is still CBS PPR 12-team.`
    );
  }
  if (teamCount !== 12) {
    conflicts.push(
      `This mock looks like ${teamCount} teams. The SportsLine sheet is still CBS PPR 12-team.`
    );
  }

  const draftSlot = Math.min(Math.max(1, league.draftSlot), teamCount);
  return {
    league: {
      ...league,
      teamCount,
      scoringFormat,
      draftSlot,
      keepers: [],
      keeperSlots: 0
    },
    conflicts
  };
}
