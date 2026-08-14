import type { Position } from "../domain/types.js";

export interface LiveDraftResult {
  overallPick: number;
  fantasyTeam: string;
  playerName: string;
  position?: Position;
  round?: number;
}

export interface LiveDraftControl {
  currentOverallPick: number | null;
  teamOnClock: string | null;
  isUserTurn: boolean;
  clockSecondsRemaining: number | null;
}

export interface LiveLeagueFacts {
  teamCount?: number;
  draftType?: "snake" | "linear";
  userTeamName?: string;
  lineup?: Partial<Record<Position, number>>;
  userKeepers?: Array<{ name: string; position: Position }>;
  userOverallPicks?: number[];
}

export interface LiveDraftSnapshot {
  url: string;
  capturedAt: string;
  control: LiveDraftControl;
  results: LiveDraftResult[];
  roster: Array<{ name: string; position?: Position }>;
  leagueFacts: LiveLeagueFacts;
  conflicts: string[];
}
