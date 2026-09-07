import { readFileSync } from "node:fs";
import type { Position, SportslinePlayer } from "../domain/types.js";
import { resolvePlayer } from "../engine/identity.js";
import { normalizeHeader, normalizePlayerName, playerKey } from "./normalize.js";
import { XLSX } from "./xlsx.js";

export interface FantasyProsRanking {
  ecrRank: number;
  tier: number;
  name: string;
  team: string;
  position: Position;
  positionRank: number;
  byeWeek: number | null;
}

export interface FantasyProsRankingsImport {
  source: "FantasyPros";
  scoringFormat: "unverified";
  usage: "comparison-only";
  players: FantasyProsRanking[];
  skippedBlankRows: number;
  duplicates: { key: string; ecrRanks: number[] }[];
}

export function parseFantasyProsRankingsCsv(csv: string): FantasyProsRankingsImport {
  const workbook = XLSX.read(csv, { type: "string", raw: true, FS: "," });
  const sheet = workbook.Sheets[workbook.SheetNames[0]!];
  const matrix = sheet ? XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1, defval: "", raw: true, blankrows: true
  }) : [];
  const headers = (matrix[0] ?? []).map((value) => normalizeHeader(String(value)));
  const required = ["RK", "TIERS", "PLAYER NAME", "TEAM", "POS", "BYE WEEK"];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`FantasyPros CSV missing headers: ${missing.join(", ")}`);
  const [rankIndex, tierIndex, nameIndex, teamIndex, positionIndex, byeIndex] =
    required.map((header) => headers.indexOf(header));
  const players: FantasyProsRanking[] = [];
  const seen = new Map<string, number[]>();
  let skippedBlankRows = 0;

  for (const [index, cells] of matrix.slice(1).entries()) {
    const row = cells.map((value) => String(value).trim());
    // The supplied export includes separator rows with only a tier populated.
    if (row.every((value, column) => column === tierIndex || value === "")) {
      skippedBlankRows += 1;
      continue;
    }
    const positiveInteger = (value: string, field: string): number => {
      const number = Number(value);
      if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(number)) {
        throw new Error(`FantasyPros CSV row ${index + 2}: invalid ${field} (${value})`);
      }
      return number;
    };
    const ecrRank = positiveInteger(row[rankIndex] ?? "", "RK");
    const tier = positiveInteger(row[tierIndex] ?? "", "TIERS");
    const name = row[nameIndex] ?? "";
    const team = row[teamIndex] ?? "";
    const positionCell = /^(QB|RB|WR|TE|K|DST)([1-9]\d*)$/.exec(row[positionIndex] ?? "");
    if (!name || !team || !positionCell) {
      throw new Error(`FantasyPros CSV row ${index + 2}: missing name/team or invalid POS`);
    }
    const position = positionCell[1] as Position;
    const positionRank = positiveInteger(positionCell[2], "position rank");
    const bye = row[byeIndex] ?? "";
    const byeWeek = bye === "" || bye === "-" ? null : positiveInteger(bye, "BYE WEEK");
    if (byeWeek !== null && byeWeek > 18) {
      throw new Error(`FantasyPros CSV row ${index + 2}: invalid BYE WEEK (${bye})`);
    }
    // ECR VS. ADP is a delta, not ADP. Neither it nor ECR supplies numeric ADP.
    players.push({ ecrRank, tier, name, team, position, positionRank, byeWeek });
    for (const key of [playerKey(name, position), `ECR::${ecrRank}`]) {
      const ranks = seen.get(key) ?? [];
      ranks.push(ecrRank);
      seen.set(key, ranks);
    }
  }

  return {
    source: "FantasyPros", scoringFormat: "unverified", usage: "comparison-only",
    players, skippedBlankRows,
    duplicates: [...seen].filter(([, ranks]) => ranks.length > 1)
      .map(([key, ecrRanks]) => ({ key, ecrRanks }))
  };
}

export function importFantasyProsRankingsCsv(path: string): FantasyProsRankingsImport {
  return parseFantasyProsRankingsCsv(readFileSync(path, "utf8"));
}

export function compareFantasyProsRankings(
  rankings: readonly FantasyProsRanking[],
  sportsline: readonly SportslinePlayer[]
) {
  const fullName = (name: string) => normalizePlayerName(name).toLowerCase()
    .replace(/\s+(jr\.?|sr\.?|ii|iii|iv)$/, "");
  const candidates = rankings.map((ranking) => {
    // Resolve each candidate separately so duplicate SportsLine identities cannot win by order.
    let matches = sportsline.filter((player) =>
      resolvePlayer([player], ranking.name, ranking.position).ok);
    if (matches.length === 0 && ranking.position !== "DST") {
      matches = sportsline.filter((player) => player.position === ranking.position &&
        fullName(player.name) === fullName(ranking.name));
    }
    return matches.length === 1 ? matches[0] : null;
  });
  const uses = new Map<string, number>();
  for (const player of candidates) {
    if (player) uses.set(player.id, (uses.get(player.id) ?? 0) + 1);
  }
  // A many-to-one join is ambiguous too, including duplicates within the CSV.
  const rows = rankings.map((fantasyPros, index) => {
    const candidate = candidates[index];
    return { fantasyPros, sportsline: candidate && uses.get(candidate.id) === 1 ? candidate : null };
  });
  const matches = rows.filter((row) => row.sportsline !== null);
  const matchedIds = new Set(matches.map((row) => row.sportsline!.id));
  return {
    rows, matches,
    unmatchedFantasyPros: rows.filter((row) => row.sportsline === null).map((row) => row.fantasyPros),
    unmatchedSportsline: sportsline.filter((player) => !matchedIds.has(player.id))
  };
}
