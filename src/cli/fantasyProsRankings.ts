import { compareFantasyProsRankings, importFantasyProsRankingsCsv } from "../data/fantasyProsRankings.js";
import { importSportslineWorkbook } from "../data/sportsline.js";

export function previewFantasyProsRankings(args: string[]): void {
  if (args.length > 1 || args.some((arg) => arg.startsWith("--"))) {
    throw new Error("Usage: fantasypros-rankings [csv-path]");
  }
  const csvPath = args[0] ?? process.env.FANTASY_PROS_RANKINGS_CSV ?? "FantasyPros_2026_Draft_ALL_Rankings.csv";
  const workbookPath = process.env.SPORTSLINE_XLSX ?? "data/reference/cheatsheet_cbsppr12.xlsx";
  const imported = importFantasyProsRankingsCsv(csvPath);
  const sportsline = importSportslineWorkbook(workbookPath);
  const comparison = compareFantasyProsRankings(imported.players, sportsline.players);

  console.log("FANTASYPROS OFFLINE CSV COMPARISON ONLY - not used in draft recommendations.");
  console.log("This analysis is based on data obtained from FantasyPros (https://www.fantasypros.com/).");
  console.log("Scoring format: unverified. The CSV does not declare scoring; PPR is not assumed.");
  console.log("API requests: 0. Local files only. SportsLine ratings and ADP are unchanged.");
  console.log("Full import comparison, not a filtered draft-availability board; keepers and drafted players are not removed.");
  console.log(`FantasyPros: ${imported.players.length} ranked rows, ${imported.skippedBlankRows} blank/separator rows skipped, ${imported.duplicates.length} duplicate groups.`);
  console.log(`SportsLine: ${sportsline.players.length} players, ${sportsline.skippedBlankRows} blank rows skipped. Matched: ${comparison.matches.length}.`);
  if (imported.duplicates.length) {
    console.log(`Duplicate samples: ${imported.duplicates.slice(0, 5).map((duplicate) =>
      `${duplicate.key} (ECR ${duplicate.ecrRanks.join(", ")})`).join("; ")}`);
  }
  console.log("Top 20 by FantasyPros ECR (not SportsLine rating order):");
  console.table([...comparison.rows].sort((a, b) => a.fantasyPros.ecrRank - b.fantasyPros.ecrRank)
    .slice(0, 20).map(({ fantasyPros, sportsline: player }) => ({
      ECR: fantasyPros.ecrRank, Tier: fantasyPros.tier, Player: fantasyPros.name,
      Position: `${fantasyPros.position}${fantasyPros.positionRank}`,
      "SportsLine Rating": player ? player.sportslineRating : "unmatched",
      "SportsLine ADP": player ? player.adp ?? "not supplied" : "unmatched"
    })));
  console.log(`Unmatched FantasyPros: ${comparison.unmatchedFantasyPros.length}. Samples: ${comparison.unmatchedFantasyPros.slice(0, 5).map((player) => player.name).join(", ") || "none"}.`);
  console.log(`Unmatched SportsLine: ${comparison.unmatchedSportsline.length}. Samples: ${comparison.unmatchedSportsline.slice(0, 5).map((player) => player.name).join(", ") || "none"}.`);
}
