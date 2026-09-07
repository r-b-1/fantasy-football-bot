import type { DraftPickEvent, LivePlayer, Position, SportslinePlayer } from "../domain/types.js";
import { playerKey } from "../data/normalize.js";
import { resyncFromDraftResults } from "../cbs/resync.js";
import type { LiveDraftSnapshot } from "../cbs/types.js";
import { mergeDraftOrder } from "../cbs/roomFacts.js";

export interface CompanionKeeper {
  fantasyTeam: string;
  name: string;
  position: Position;
}

export interface CompanionPick {
  overallPick: number;
  fantasyTeam: string;
  playerId: string;
  playerName: string;
  position: Position;
}

export type RoomKind = "manual" | "fixture" | "live";
export type RoomConnectionStatus =
  | "disconnected"
  | "connecting"
  | "awaiting_draft_room"
  | "watching"
  | "error";

export interface RoomOverlay {
  currentOverallPick: number | null;
  teamOnClock: string | null;
  isUserTurn: boolean;
  youAreUp: boolean;
  waitingToStart: boolean;
  clockSecondsRemaining: number | null;
  clockRaw: string | null;
  secondsPerPick: number | null;
  pickClockRaw: string | null;
  draftOrder: string[];
  url: string | null;
  capturedAt: string;
  conflicts: string[];
}

export interface RoomPublicStatus {
  kind: RoomKind;
  status: RoomConnectionStatus;
  writable: boolean;
  liveAllowed: boolean;
  url: string | null;
  targetUrl: string | null;
  clockSecondsRemaining: number | null;
  clockRaw: string | null;
  waitingToStart: boolean;
  secondsPerPick: number | null;
  pickClockRaw: string | null;
  youAreUp: boolean;
  conflicts: string[];
  error: string | null;
  lastSnapshotAt: string | null;
}

export interface RoomSyncBoard {
  draftedPicks: CompanionPick[];
  draftEvents: DraftPickEvent[];
  slPool: LivePlayer[];
  fpPool: LivePlayer[];
  allKeepers: CompanionKeeper[];
  room: RoomOverlay | null;
}

export function roomIsWritable(status: RoomConnectionStatus): boolean {
  return status === "disconnected" || status === "error";
}

export function applyKeeperExclusions(board: RoomSyncBoard): void {
  const unavailableKeys = new Set(board.allKeepers.map((keeper) => playerKey(keeper.name, keeper.position)));
  for (const player of board.slPool) player.available = !unavailableKeys.has(player.id);
  for (const player of board.fpPool) player.available = !unavailableKeys.has(player.id);
}

export function clearDraftedPicks(board: RoomSyncBoard): void {
  board.draftedPicks = [];
  board.draftEvents = [];
  board.room = null;
  applyKeeperExclusions(board);
}

function pickPosition(event: DraftPickEvent, players: SportslinePlayer[]): Position {
  if (event.position) return event.position;
  return players.find((player) => player.id === event.playerId)?.position ?? "WR";
}

export function applyRoomSnapshot(
  board: RoomSyncBoard,
  snapshot: LiveDraftSnapshot,
  players: SportslinePlayer[]
): { conflicts: string[] } {
  const conflicts = [...snapshot.conflicts];
  const staleEmpty =
    snapshot.results.length === 0 &&
    board.draftedPicks.length > 0 &&
    (snapshot.control.currentOverallPick ?? 1) > 1;

  if (staleEmpty) {
    conflicts.push(
      "Room snapshot had no draft results while the draft appears underway; keeping last synced board."
    );
  } else {
    const resync = resyncFromDraftResults(board.draftEvents, snapshot.results, players, snapshot.capturedAt);
    conflicts.push(...resync.conflicts);
    board.draftEvents = resync.events;
    board.draftedPicks = resync.events.map((event) => ({
      overallPick: event.overallPick,
      fantasyTeam: event.fantasyTeam,
      playerId: event.playerId,
      playerName: event.playerName,
      position: pickPosition(event, players)
    }));
    applyKeeperExclusions(board);
    const taken = new Set(resync.events.map((event) => event.playerId));
    for (const player of board.slPool) {
      if (taken.has(player.id)) player.available = false;
    }
    for (const player of board.fpPool) {
      if (taken.has(player.id)) player.available = false;
    }
  }

  board.room = {
    currentOverallPick: snapshot.control.currentOverallPick,
    teamOnClock: snapshot.control.teamOnClock,
    isUserTurn: snapshot.control.isUserTurn,
    youAreUp: snapshot.control.youAreUp,
    waitingToStart: snapshot.control.waitingToStart,
    clockSecondsRemaining: snapshot.control.clockSecondsRemaining,
    clockRaw: snapshot.control.clockRaw,
    secondsPerPick: snapshot.control.secondsPerPick,
    pickClockRaw: snapshot.control.pickClockRaw,
    draftOrder: mergeDraftOrder(board.room?.draftOrder ?? [], snapshot.control.draftOrder),
    url: snapshot.url,
    capturedAt: snapshot.capturedAt,
    conflicts
  };
  return { conflicts };
}
