import { loadLeagueConfig } from "../config/load.js";
import { loadFantasyProsPreview, FANTASY_PROS_LOCAL_REQUEST_LIMIT } from "../data/fantasyPros.js";
import { loadSportslineWorkbook } from "../data/sportsline.js";
import { POSITIONS, type Position } from "../domain/types.js";
import { resolvePlayer } from "../engine/identity.js";

export async function previewFantasyPros(args: string[]): Promise<void> {
  const position = args.find((arg) => !arg.startsWith("--")) ?? "RB";
  if (!POSITIONS.includes(position as Position) || args.some((arg) => arg.startsWith("--") && arg !== "--refresh") ||
      args.filter((arg) => !arg.startsWith("--")).length > 1) {
    throw new Error("Usage: npm run fantasypros:preview -- [QB|RB|WR|TE|K|DST] [--refresh]");
  }
  const league = loadLeagueConfig(process.env.LEAGUE_CONFIG ?? "config/league.current.json");
  const sportsline = loadSportslineWorkbook(process.env.SPORTSLINE_XLSX ?? "data/reference/cheatsheet_cbsppr12.xlsx");
  const { data, requestsMade, locallyRecordedAttempts } = await loadFantasyProsPreview({
    season: league.season, position: position as Position,
    refresh: args.includes("--refresh"), apiKey: process.env.FANTASY_PROS_API
  });
  console.log("FANTASYPROS SAMPLE PREVIEW ONLY - not used in draft recommendations.");
  console.log("This analysis is based on data obtained from FantasyPros (https://www.fantasypros.com/).");
  console.log(`${data.season} preseason ${data.position}, PPR projected points. Fetched ${data.fetchedAt}.`);
  console.log(`Returned ${data.players.length} players; provider reports ${data.reportedCount}. Coverage is not verified.`);
  if (data.players.length === 0) console.log("No usable projections returned. Prefer the offline CSV comparison; do not keep refreshing an empty dataset.");
  console.log(`API requests this run: ${requestsMade}. Locally recorded attempts: ${locallyRecordedAttempts}/${FANTASY_PROS_LOCAL_REQUEST_LIMIT} safety cap (NOT your provider balance).`);
  console.log("Cached data is never auto-refreshed. SportsLine ratings and ADP are unchanged.");
  console.table(data.players.map((player) => {
    const match = resolvePlayer(sportsline, player.name, player.position);
    return {
      Player: player.name, Position: player.position, "FP PPR Points": player.projectedPprPoints,
      "SportsLine Rating": match.ok ? match.player.sportslineRating : "unmatched",
      "SportsLine ADP": match.ok ? match.player.adp : "unmatched"
    };
  }));
}
