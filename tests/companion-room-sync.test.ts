import { describe, expect, it } from "vitest";
import {
  applyKeeperExclusions,
  applyRoomSnapshot,
  clearDraftedPicks,
  roomIsWritable,
  type RoomSyncBoard
} from "../src/companion/roomSync.js";
import type { LiveDraftSnapshot } from "../src/cbs/types.js";
import type { LivePlayer, SportslinePlayer } from "../src/domain/types.js";

function sportsline(name: string, position: SportslinePlayer["position"], rating = 80): SportslinePlayer {
  return {
    id: `${name.toLowerCase()}::${position}`,
    sourceName: name,
    name,
    position,
    sportslineRating: rating,
    adp: 20,
    listedRound: 2,
    byeWeek: 7
  };
}

function live(player: SportslinePlayer, available = true): LivePlayer {
  return { ...player, available };
}

const jacobs = sportsline("Josh Jacobs", "RB", 92);
const bijan = sportsline("Bijan Robinson", "RB", 96);
const jeanty = sportsline("Ashton Jeanty", "RB", 88);

function board(available: SportslinePlayer[] = [jacobs, bijan]): RoomSyncBoard {
  const keepers = [{ fantasyTeam: "Pickens My Jeanty", name: jeanty.name, position: jeanty.position }] as const;
  const next: RoomSyncBoard = {
    draftedPicks: [],
    draftEvents: [],
    slPool: [jeanty, ...available].map((player) => live(player)),
    fpPool: [jeanty, ...available].map((player) => live(player)),
    allKeepers: [...keepers],
    room: null
  };
  applyKeeperExclusions(next);
  return next;
}

function snapshot(partial: Partial<LiveDraftSnapshot> & { results?: LiveDraftSnapshot["results"] }): LiveDraftSnapshot {
  return {
    url: "http://127.0.0.1:9/fixture-draft-room-rich",
    capturedAt: "2026-09-07T12:00:00.000Z",
    control: {
      currentOverallPick: 2,
      teamOnClock: "Gibbs me a win",
      isUserTurn: false,
      youAreUp: false,
      waitingToStart: false,
      clockSecondsRemaining: 8,
      clockRaw: "0:08",
      secondsPerPick: 90,
      pickClockRaw: "Time Between Picks: 1:30",
      draftOrder: ["Hairy Butterscotch", "Gibbs me a win"]
    },
    results: [],
    roster: [],
    leagueFacts: {},
    conflicts: [],
    ...partial
  };
}

describe("companion room sync", () => {
  it("treats only a disconnected or errored room as writable", () => {
    expect(roomIsWritable("disconnected")).toBe(true);
    expect(roomIsWritable("error")).toBe(true);
    expect(roomIsWritable("connecting")).toBe(false);
    expect(roomIsWritable("awaiting_draft_room")).toBe(false);
    expect(roomIsWritable("watching")).toBe(false);
  });

  it("applies resolved room results onto the local board and clock overlay", () => {
    const next = board();
    const result = applyRoomSnapshot(
      next,
      snapshot({
        results: [{ overallPick: 1, fantasyTeam: "Hairy Butterscotch", playerName: "Josh Jacobs" }]
      }),
      [jacobs, bijan, jeanty]
    );
    expect(result.conflicts).toEqual([]);
    expect(next.draftedPicks).toEqual([
      {
        overallPick: 1,
        fantasyTeam: "Hairy Butterscotch",
        playerId: jacobs.id,
        playerName: "Josh Jacobs",
        position: "RB"
      }
    ]);
    expect(next.slPool.find((player) => player.id === jacobs.id)?.available).toBe(false);
    expect(next.fpPool.find((player) => player.id === jacobs.id)?.available).toBe(false);
    expect(next.slPool.find((player) => player.id === bijan.id)?.available).toBe(true);
    expect(next.slPool.find((player) => player.id === jeanty.id)?.available).toBe(false);
    expect(next.room).toMatchObject({
      currentOverallPick: 2,
      teamOnClock: "Gibbs me a win",
      isUserTurn: false,
      clockSecondsRemaining: 8,
      secondsPerPick: 90,
      draftOrder: ["Hairy Butterscotch", "Gibbs me a win"],
      conflicts: []
    });
  });

  it("keeps the last board when a mid-draft snapshot comes back with no results", () => {
    const next = board();
    applyRoomSnapshot(
      next,
      snapshot({
        results: [{ overallPick: 1, fantasyTeam: "Hairy Butterscotch", playerName: "Josh Jacobs" }]
      }),
      [jacobs, bijan, jeanty]
    );
    const result = applyRoomSnapshot(
      next,
      snapshot({
        control: {
          currentOverallPick: 3,
          teamOnClock: "Pickens My Jeanty",
          isUserTurn: true,
          youAreUp: true,
          waitingToStart: false,
          clockSecondsRemaining: 21,
          clockRaw: "0:21",
          secondsPerPick: 90,
          pickClockRaw: "Time Between Picks: 1:30",
          draftOrder: ["Hairy Butterscotch", "Gibbs me a win", "Pickens My Jeanty"]
        },
        results: []
      }),
      [jacobs, bijan, jeanty]
    );
    expect(next.draftedPicks).toHaveLength(1);
    expect(next.draftedPicks[0]?.playerName).toBe("Josh Jacobs");
    expect(result.conflicts).toEqual([
      "Room snapshot had no draft results while the draft appears underway; keeping last synced board."
    ]);
    expect(next.room?.currentOverallPick).toBe(3);
    expect(next.room?.isUserTurn).toBe(true);
    expect(next.room?.conflicts).toEqual(result.conflicts);
  });

  it("keeps previously revealed CBS draft-order names when a later snapshot is shorter", () => {
    const next = board();
    applyRoomSnapshot(
      next,
      snapshot({
        control: {
          currentOverallPick: 1,
          teamOnClock: "Waiting for Start",
          isUserTurn: false,
          youAreUp: false,
          waitingToStart: true,
          clockSecondsRemaining: 90,
          clockRaw: "1:30",
          secondsPerPick: null,
          pickClockRaw: null,
          draftOrder: ["Yo Mama", "Clyde", "Pickens My Jeanty"]
        }
      }),
      [jacobs, bijan, jeanty]
    );
    applyRoomSnapshot(
      next,
      snapshot({
        control: {
          currentOverallPick: 1,
          teamOnClock: "Waiting for Start",
          isUserTurn: false,
          youAreUp: false,
          waitingToStart: true,
          clockSecondsRemaining: 89,
          clockRaw: "1:29",
          secondsPerPick: null,
          pickClockRaw: null,
          draftOrder: ["Clyde", "Pickens My Jeanty", "Dezzie Does Dallas"]
        }
      }),
      [jacobs, bijan, jeanty]
    );
    expect(next.room?.draftOrder).toEqual([
      "Yo Mama",
      "Clyde",
      "Pickens My Jeanty",
      "Dezzie Does Dallas"
    ]);
  });

  it("records an unresolved room pick as a conflict without inventing a player", () => {
    const next = board();
    const result = applyRoomSnapshot(
      next,
      snapshot({
        results: [{ overallPick: 1, fantasyTeam: "Hairy Butterscotch", playerName: "Nobody Unknown" }]
      }),
      [jacobs, bijan, jeanty]
    );
    expect(next.draftedPicks).toEqual([]);
    expect(result.conflicts[0]).toMatch(/could not be matched unambiguously/);
    expect(next.room?.conflicts).toEqual(result.conflicts);
  });

  it("clears recorded picks back to keeper exclusions", () => {
    const next = board();
    applyRoomSnapshot(
      next,
      snapshot({
        results: [{ overallPick: 1, fantasyTeam: "Hairy Butterscotch", playerName: "Josh Jacobs" }]
      }),
      [jacobs, bijan, jeanty]
    );
    clearDraftedPicks(next);
    expect(next.draftedPicks).toEqual([]);
    expect(next.room).toBeNull();
    expect(next.slPool.find((player) => player.id === jacobs.id)?.available).toBe(true);
    expect(next.slPool.find((player) => player.id === jeanty.id)?.available).toBe(false);
  });
});
