import type {
  CandidateScore,
  DraftDecision,
  DraftState,
  LeagueConfig,
  NextPicksProjection,
  ProjectedPick
} from "../domain/types.js";

function pad(value: string, width: number): string {
  if (value.length === width) return value;
  if (value.length > width) return value.slice(0, width);
  return value + " ".repeat(width - value.length);
}

function num(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return value.toFixed(digits);
}

export function formatShortlist(
  ranked: CandidateScore[],
  state: DraftState,
  league: LeagueConfig,
  options: { explain?: "all" | "top" | "none" } = {}
): string {
  const roster = state.roster.players
    .map((p) => `${p.position} ${p.name} (${p.source})`)
    .join(", ") || "(empty)";

  const clock =
    state.clockSecondsRemaining == null
      ? null
      : `${Math.floor(state.clockSecondsRemaining / 60)}:${String(state.clockSecondsRemaining % 60).padStart(2, "0")}`;
  const header = [
    `PICK ${state.currentOverallPick} — ${state.teamOnClock ?? "unknown team"} ${state.isUserTurn ? "is on the clock" : "is not the user"}${clock ? ` — ${clock}` : ""}`,
    `Next user pick: ${state.nextUserOverallPick ?? "none configured"}`,
    `Roster: ${roster}`,
    `Mode: ${league.executionMode.toUpperCase()}`,
    ...(state.warnings.length > 0 ? state.warnings.map((warning) => `Warning: ${warning}`) : []),
    "",
    [
      pad("#", 3),
      pad("Player", 22),
      pad("Pos", 4),
      pad("Score", 7),
      pad("SL", 5),
      pad("ADP", 7),
      pad("ADPΔ", 7),
      pad("Need", 6),
      pad("Scar", 6),
      pad("Risk", 6),
      pad("Cliff", 6),
      pad("Pen", 5)
    ].join(" ")
  ];

  const rows = ranked.map((candidate, index) => {
    const adpDelta =
      candidate.player.adp == null ? null : state.currentOverallPick - candidate.player.adp;
    return [
      pad(String(index + 1), 3),
      pad(candidate.player.name, 22),
      pad(candidate.player.position, 4),
      pad(num(candidate.score, 2), 7),
      pad(num(candidate.player.sportslineRating, 0), 5),
      pad(num(candidate.player.adp, 2), 7),
      pad(adpDelta == null ? "n/a" : `${adpDelta >= 0 ? "+" : ""}${adpDelta.toFixed(1)}`, 7),
      pad(num(candidate.components.rosterNeed, 1), 6),
      pad(num(candidate.components.scarcity, 1), 6),
      pad(num(candidate.components.nextPickRisk, 1), 6),
      pad(num(candidate.components.tierCliff, 1), 6),
      pad(num(candidate.components.penalties, 1), 5)
    ].join(" ");
  });

  const explainCount =
    options.explain === "none" ? 0 : options.explain === "top" ? Math.min(1, ranked.length) : ranked.length;
  const explanations = ranked.slice(0, explainCount).flatMap((candidate, index) => [
    "",
    `${index + 1}. ${candidate.player.name} (${candidate.player.position})`,
    ...candidate.notes.map((note) => `   ${note}`)
  ]);

  return [...header, ...rows, ...explanations].join("\n");
}

export function formatRecommendation(
  ranked: CandidateScore[],
  state: DraftState,
  league: LeagueConfig,
  decision: DraftDecision,
  options: { explain?: "all" | "top" | "none"; previewForTeam?: string } = {}
): string {
  const selected =
    ranked.find((candidate) => candidate.player.id === decision.selectedCandidateId) ?? ranked[0];
  const fallback = ranked[0];
  const preview =
    options.previewForTeam != null
      ? [
          `LIKELY PICK FOR ${options.previewForTeam} — same recommend banner you'll see on your turn`,
          ""
        ]
      : [];
  const lines = [
    ...preview,
    formatShortlist(ranked, state, league, options),
    "",
    decision.source === "ai"
      ? `AI: ${selected?.player.name} (${decision.confidence.toFixed(2)} confidence, ${decision.latencyMs}ms)`
      : "AI: not used",
    `Fallback: ${fallback?.player.name ?? "none"}`
  ];
  if (decision.source === "ai") {
    lines.push(`Rationale: ${decision.rationale}`);
  }
  if (decision.fallbackReason) {
    lines.push(`AI fallback: ${decision.fallbackReason}`);
  }
  if (decision.riskFlags.length > 0 && decision.source === "ai") {
    lines.push(`Risk flags: ${decision.riskFlags.join(", ")}`);
  }
  return lines.join("\n");
}

export interface FormattableProjection extends NextPicksProjection {
  source?: ProjectedPick["source"];
}

export function formatProjection(projection: FormattableProjection): string {
  const sourceLabel = projection.source ?? "unknown";
  const header = [
    `PROJECTED NEXT ${projection.horizon} PICKS — current overall pick ${projection.currentOverallPick} (${sourceLabel})`,
    ...projection.notes.map((note) => `  ${note}`)
  ];
  if (projection.projectedPicks.length === 0) {
    return [...header, "  (no projection available)"].join("\n");
  }
  const rows = projection.projectedPicks.map((pick, index) =>
    [
      pad(String(index + 1), 3),
      pad(pick.playerName, 22),
      pad(pick.position, 4),
      pad(`#${pick.expectedOverallPick}`, 7),
      pad(`(${pick.confidence.toFixed(2)})`, 9)
    ].join(" ")
  );
  return [...header, ...rows].join("\n");
}
