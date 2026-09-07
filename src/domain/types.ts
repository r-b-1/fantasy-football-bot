export const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DST"] as const;
export type Position = (typeof POSITIONS)[number];

export type ExecutionMode = "monitor" | "recommend" | "confirm" | "autopilot";

export const RISK_FLAGS = [
  "NONE",
  "POSITION_RUN",
  "TIER_CLIFF",
  "TE_TIER_CLIFF",
  "ROSTER_IMBALANCE",
  "BYE_OVERLAP",
  "LOW_CONFIDENCE",
  "STALE_DATA"
] as const;
export type RiskFlag = (typeof RISK_FLAGS)[number];

export interface SportslinePlayer {
  id: string;
  sourceName: string;
  name: string;
  position: Position;
  sportslineRating: number;
  adp: number | null;
  listedRound: number | null;
  byeWeek: number | null;
}

export interface LivePlayer extends SportslinePlayer {
  nflTeam?: string;
  cbsPlayerId?: string;
  projectedPoints?: number;
  cbsPositionRank?: number;
  available: boolean;
}

export interface KeeperRef {
  name: string;
  position: Position;
}

export interface CompletedTrade {
  description: string;
  sentPlayers: string[];
  sentOverallPicks: number[];
  receivedOverallPicks: number[];
}

export interface LeaguePickAssignment {
  teamName: string;
  picks: number[];
}

export interface LeagueConfig {
  platform: "CBS";
  season: number;
  leagueName: string;
  userTeamName: string;
  fantasyDisplayName: string;
  teamCount: number;
  scoringFormat: "PPR" | "HALF_PPR" | "NON_PPR";
  draftType: "snake" | "linear";
  draftTypeVerificationRequired: boolean;
  draftSlot: number;
  keeperSlots: number;
  keepers: KeeperRef[];
  completedTrades: CompletedTrade[];
  knownOverallPicks: number[];
  knownPicksArePartial: boolean;
  /** Team names in draft-slot order (index 0 = slot 1). */
  draftOrder?: string[];
  /** Per-team overall pick lists. Overlay on snake math so traded picks change owners. */
  leaguePicks: LeaguePickAssignment[];
  leaguePicksArePartial: boolean;
  /** Path to JSON/CSV of all teams' keepers for live projection. */
  leagueKeepersPath?: string;
  lineup: Record<Position, number>;
  benchSlots: number | null;
  rosterMaximums: Partial<Record<Position, number>>;
  executionMode: ExecutionMode;
  cbsExecutionEnabled: boolean;
  /** When true, lock userTeamName / draft slot from the live YOU ARE UP state. */
  inferUserTeamFromYouAreUp?: boolean;
  /** Path to a preseason roster CSV used for per-team need projection. */
  rosterGridPath?: string;
  notes: string[];
}

export interface StrategyWeights {
  sportslineRating: number;
  adpValue: number;
  rosterNeed: number;
  scarcity: number;
  nextPickRisk: number;
  tierCliff: number;
}

export interface StrategyConfig {
  candidateShortlistSize: number;
  aiConfidenceThreshold: number;
  aiTimeoutMs: number;
  minimumExecutionClockSeconds: number;
  freshStateMaxAgeMs: number;
  weights: StrategyWeights;
  earlyRoundPositionPenalties: Partial<Record<Position, number>>;
  kDstEligibleAfterOverallPick: number;
  byeOverlapPenalty: number;
  vorWeight: number;
  recentPickWindow: number;
  softDraftPlan: Record<string, string>;
  notes: string[];
}

export interface DraftPickEvent {
  overallPick: number;
  round?: number;
  fantasyTeam: string;
  playerId: string;
  playerName: string;
  position?: Position;
  nflTeam?: string;
  observedAt: string;
}

export interface RosterPlayer {
  playerId: string;
  name: string;
  position: Position;
  byeWeek: number | null;
  source: "keeper" | "draft";
}

export interface UserRoster {
  players: RosterPlayer[];
}

export interface DraftState {
  currentOverallPick: number;
  nextUserOverallPick: number | null;
  teamOnClock: string | null;
  isUserTurn: boolean;
  clockSecondsRemaining: number | null;
  snapshotAt: string;
  roster: UserRoster;
  draftEvents: DraftPickEvent[];
  availablePlayerIds: Set<string>;
  recentPositionCounts: Partial<Record<Position, number>>;
  warnings: string[];
}

export interface CandidateComponentScores {
  sportslineRating: number;
  adpValue: number;
  rosterNeed: number;
  scarcity: number;
  nextPickRisk: number;
  tierCliff: number;
  vor?: number;
  penalties: number;
}

export interface CandidateScore {
  player: LivePlayer;
  score: number;
  components: CandidateComponentScores;
  notes: string[];
}

export interface DraftDecision {
  selectedCandidateId: string;
  confidence: number;
  rationale: string;
  alternativeCandidateIds: string[];
  riskFlags: RiskFlag[];
  source: "ai" | "deterministic_fallback";
  latencyMs: number;
  fallbackReason?: string;
}

export interface FixtureKeeper {
  name: string;
  position: Position;
  fantasyTeam: string;
}

export interface FixturePick {
  overallPick: number;
  fantasyTeam: string;
  playerName: string;
  position?: Position;
  nflTeam?: string;
}

export interface DraftFixture {
  name: string;
  description?: string;
  currentOverallPick: number;
  teamOnClock?: string | null;
  keepers: FixtureKeeper[];
  drafted: FixturePick[];
}

export interface ProjectedPick {
  playerId: string;
  playerName: string;
  position: Position;
  expectedOverallPick: number;
  confidence: number;
  source: "ai" | "deterministic";
  fallbackReason?: string;
}

export interface NextPicksProjection {
  generatedAt: string;
  currentOverallPick: number;
  horizon: number;
  projectedPicks: ProjectedPick[];
  notes: string[];
}
