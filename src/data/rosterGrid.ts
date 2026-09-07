import fs from "node:fs";
import type { Position } from "../domain/types.js";

export interface RosterEntry {
  name: string;
  position: Position;
  isRookie: boolean;
}

export interface TeamRoster {
  teamName: string;
  starters: Partial<Record<Position, RosterEntry[]>>;
}

export interface RosterGrid {
  source: string;
  loadedAt: string;
  teams: TeamRoster[];
}

const POSITION_KEYS: Position[] = ["QB", "RB", "WR", "TE", "K", "DST"];

const STARTER_DELIMITERS = /[;,]/g;

function parseCell(cell: string): RosterEntry[] {
  if (!cell || !cell.trim()) return [];
  const trimmed = cell.trim();
  const segments = trimmed
    .split(/[;,]/)
    .flatMap((part) => splitGluedNames(part))
    .map((part) => part.trim())
    .filter(Boolean);
  return segments.map((part) => {
    const isRookie = /\(R\)\s*$/i.test(part);
    const stripped = part.replace(/\(R\)\s*$/i, "").trim();
    const match = stripped.match(/^([A-Za-z][A-Za-z'\-\s]*?)\s+([A-Z][A-Za-z'\-\.\s]*)$/);
    if (!match) {
      return { name: stripped, position: "WR" as Position, isRookie };
    }
    const first = match[1]!.trim();
    const last = match[2]!.trim();
    return { name: `${first} ${last}`, position: "WR" as Position, isRookie };
  });
}

function splitGluedNames(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];

  const pieces: string[] = [];
  let current = "";
  let i = 0;
  while (i < trimmed.length) {
    const char = trimmed[i]!;
    current += char;
    const next = trimmed[i + 1];
    const afterNext = trimmed[i + 2];

    if (next && current.endsWith("(R)")) {
      pieces.push(current.trim());
      current = "";
      i += 1;
      continue;
    }

    const isMcPrefix = current.endsWith("Mc") || current.endsWith("Mac");
    if (
      !isMcPrefix &&
      next &&
      /[a-z]/.test(char) &&
      /[A-Z]/.test(next) &&
      current.trim().length > 0 &&
      (!afterNext || afterNext !== "c" || !/[A-Z]/.test(next))
    ) {
      pieces.push(current.trim());
      current = "";
    }
    i += 1;
  }
  if (current.trim().length > 0) pieces.push(current.trim());
  return pieces;
}

function inferPositionFromTeamContext(
  roster: Partial<Record<Position, RosterEntry[]>>,
  teamName: string,
  columnPosition: Position
): RosterEntry[] {
  return roster[columnPosition] ?? [];
}

export function parseRosterGrid(csvText: string, source: string): RosterGrid {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { source, loadedAt: new Date().toISOString(), teams: [] };
  }

  const header = lines[0]!.split(",").map((col) => col.trim());
  const headerIndex: Partial<Record<Position, number>> = {};
  header.forEach((col, index) => {
    if ((POSITION_KEYS as string[]).includes(col)) {
      headerIndex[col as Position] = index;
    }
  });

  const teams: TeamRoster[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const teamName = cells[0]?.trim() ?? "";
    if (!teamName) continue;

    const starters: Partial<Record<Position, RosterEntry[]>> = {};
    for (const position of POSITION_KEYS) {
      const cellIndex = headerIndex[position];
      if (cellIndex == null) continue;
      const cell = cells[cellIndex] ?? "";
      const entries = parseCell(cell);
      if (entries.length > 0) {
        starters[position] = entries;
      }
    }

    void inferPositionFromTeamContext;
    void teamName;
    teams.push({ teamName, starters });
  }

  return { source, loadedAt: new Date().toISOString(), teams };
}

export function loadRosterGrid(csvPath: string): RosterGrid {
  const text = fs.readFileSync(csvPath, "utf8");
  return parseRosterGrid(text, csvPath);
}

export function mergeDraftedIntoRoster(
  roster: RosterGrid,
  drafted: Array<{ fantasyTeam: string; playerName: string; position?: Position }>
): RosterGrid {
  const byTeam = new Map<string, TeamRoster>();
  for (const team of roster.teams) byTeam.set(team.teamName.toLowerCase(), team);

  for (const pick of drafted) {
    const key = pick.fantasyTeam.toLowerCase();
    const team = byTeam.get(key);
    if (!team || !pick.position) continue;
    const position = pick.position;
    const existing = team.starters[position] ?? [];
    team.starters = {
      ...team.starters,
      [position]: [
        ...existing,
        { name: pick.playerName, position, isRookie: false }
      ]
    };
  }

  return { ...roster, teams: Array.from(byTeam.values()) };
}

export function teamStarterCount(roster: TeamRoster, position: Position): number {
  return roster.starters[position]?.length ?? 0;
}

export function allTeamNames(roster: RosterGrid): string[] {
  return roster.teams.map((team) => team.teamName);
}

export function teamByName(roster: RosterGrid, name: string): TeamRoster | undefined {
  return roster.teams.find((team) => team.teamName.toLowerCase() === name.toLowerCase());
}