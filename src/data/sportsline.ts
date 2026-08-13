import * as XLSX from "xlsx";
import { POSITIONS, type Position, type SportslinePlayer } from "../domain/types.js";

interface RawRow {
  "OPTIMAL POSITION RATING"?: string | number;
  PLAYER?: string;
  ADP?: string | number;
  ROUND?: string | number;
  "BYE WEEK"?: string | number;
}

export function normalizePlayerName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function playerKey(name: string, position: Position): string {
  return `${normalizePlayerName(name).toLowerCase()}::${position}`;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function loadSportslineWorkbook(path: string): SportslinePlayer[] {
  const workbook = XLSX.readFile(path);
  const players: SportslinePlayer[] = [];

  for (const position of POSITIONS) {
    const sheet = workbook.Sheets[position];
    if (!sheet) throw new Error(`Missing SportsLine sheet: ${position}`);

    const rows = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: null });
    for (const row of rows) {
      if (!row.PLAYER) continue;
      const rating = numberOrNull(row["OPTIMAL POSITION RATING"]);
      if (rating === null) continue;

      const sourceName = String(row.PLAYER);
      const name = normalizePlayerName(sourceName);
      const id = playerKey(name, position);

      players.push({
        id,
        sourceName,
        name,
        position,
        sportslineRating: rating,
        adp: numberOrNull(row.ADP),
        listedRound: numberOrNull(row.ROUND),
        byeWeek: numberOrNull(row["BYE WEEK"])
      });
    }
  }

  const seen = new Map<string, SportslinePlayer>();
  for (const player of players) {
    const prior = seen.get(player.id);
    if (prior) {
      throw new Error(
        `Duplicate normalized player key ${player.id}: ${prior.sourceName} vs ${player.sourceName}`
      );
    }
    seen.set(player.id, player);
  }

  return players;
}
