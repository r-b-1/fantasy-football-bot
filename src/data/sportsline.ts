import { duplicatePlayerKeys, missingHeaders, missingSheet } from "../domain/errors.js";
import { POSITIONS, type Position, type SportslinePlayer } from "../domain/types.js";
import { normalizeHeader, normalizePlayerName, playerKey } from "./normalize.js";
import { XLSX } from "./xlsx.js";

const REQUIRED_HEADERS = {
  rating: "OPTIMAL POSITION RATING",
  player: "PLAYER",
  adp: "ADP",
  round: "ROUND",
  byeWeek: "BYE WEEK"
} as const;

type HeaderIndex = Record<keyof typeof REQUIRED_HEADERS, number>;

export interface SportslineImportResult {
  players: SportslinePlayer[];
  skippedBlankRows: number;
  sheets: Position[];
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

function cell(row: unknown[], index: number): unknown {
  if (index < 0 || index >= row.length) return null;
  return row[index] ?? null;
}

function mapHeaders(headerRow: unknown[], sheet: Position): HeaderIndex {
  const normalized = headerRow.map((value) =>
    typeof value === "string" || typeof value === "number" ? normalizeHeader(String(value)) : ""
  );
  const index: HeaderIndex = {
    rating: normalized.indexOf(REQUIRED_HEADERS.rating),
    player: normalized.indexOf(REQUIRED_HEADERS.player),
    adp: normalized.indexOf(REQUIRED_HEADERS.adp),
    round: normalized.indexOf(REQUIRED_HEADERS.round),
    byeWeek: normalized.indexOf(REQUIRED_HEADERS.byeWeek)
  };
  const missing = (Object.entries(REQUIRED_HEADERS) as Array<[keyof typeof REQUIRED_HEADERS, string]>)
    .filter(([key]) => index[key] < 0)
    .map(([, label]) => label);
  if (missing.length > 0) throw missingHeaders(sheet, missing);
  return index;
}

function parseRow(
  row: unknown[],
  position: Position,
  headers: HeaderIndex
): SportslinePlayer | "blank" {
  const sourceNameRaw = cell(row, headers.player);
  const sourceName = sourceNameRaw == null ? "" : String(sourceNameRaw);
  const rating = numberOrNull(cell(row, headers.rating));
  if (!sourceName.trim() || rating === null) return "blank";

  const name = normalizePlayerName(sourceName, position);
  return {
    id: playerKey(name, position),
    sourceName,
    name,
    position,
    sportslineRating: rating,
    adp: numberOrNull(cell(row, headers.adp)),
    listedRound: numberOrNull(cell(row, headers.round)),
    byeWeek: numberOrNull(cell(row, headers.byeWeek))
  };
}

export function importSportslineWorkbook(path: string): SportslineImportResult {
  const workbook = XLSX.readFile(path);
  const players: SportslinePlayer[] = [];
  let skippedBlankRows = 0;

  for (const position of POSITIONS) {
    const sheet = workbook.Sheets[position];
    if (!sheet) throw missingSheet(position);

    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      raw: true
    });
    const headerRow = matrix[0];
    if (!headerRow) throw missingHeaders(position, Object.values(REQUIRED_HEADERS));
    const headers = mapHeaders(headerRow, position);

    for (const row of matrix.slice(1)) {
      if (!Array.isArray(row)) {
        skippedBlankRows += 1;
        continue;
      }
      const parsed = parseRow(row, position, headers);
      if (parsed === "blank") {
        skippedBlankRows += 1;
        continue;
      }
      players.push(parsed);
    }
  }

  const collisions = new Map<string, string[]>();
  const seen = new Map<string, SportslinePlayer>();
  for (const player of players) {
    const prior = seen.get(player.id);
    if (prior) {
      const names = collisions.get(player.id) ?? [prior.sourceName];
      names.push(player.sourceName);
      collisions.set(player.id, names);
      continue;
    }
    seen.set(player.id, player);
  }

  if (collisions.size > 0) {
    throw duplicatePlayerKeys(
      [...collisions.entries()].map(([key, names]) => ({ key, names }))
    );
  }

  return {
    players,
    skippedBlankRows,
    sheets: [...POSITIONS]
  };
}

export function loadSportslineWorkbook(path: string): SportslinePlayer[] {
  return importSportslineWorkbook(path).players;
}

export { normalizePlayerName, playerKey } from "./normalize.js";
