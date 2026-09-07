import { describe, expect, it } from "vitest";
import { loadLeagueConfig, loadStrategyConfig } from "../src/config/load.js";
import {
  computeAdpValue,
  computeNextPickRisk,
  computeRosterNeed,
  scoreCandidates
} from "../src/engine/scoring.js";
import { generateShortlist } from "../src/engine/shortlist.js";
import type { DraftState, LeagueConfig, LivePlayer, Position, StrategyConfig } from "../src/domain/types.js";

const league = loadLeagueConfig("config/league.current.json");
const strategy = loadStrategyConfig("config/strategy.current.json");

function player(overrides: Partial<LivePlayer> & Pick<LivePlayer, "id" | "name" | "position">): LivePlayer {
  return {
    sourceName: overrides.name,
    sportslineRating: 80,
    adp: 30,
    listedRound: 3,
    byeWeek: 7,
    available: true,
    ...overrides
  };
}

function state(overrides: Partial<DraftState> = {}): DraftState {
  return {
    currentOverallPick: 21,
    nextUserOverallPick: 30,
    teamOnClock: league.userTeamName,
    isUserTurn: true,
    clockSecondsRemaining: null,
    snapshotAt: "test",
    roster: { players: [] },
    draftEvents: [],
    availablePlayerIds: new Set(),
    recentPositionCounts: {},
    warnings: [],
    ...overrides
  };
}

function roster(...positions: Position[]): DraftState["roster"] {
  return { players: positions.map((position, index) => ({
    playerId: `rostered-${index}`, name: `Rostered ${index}`, position,
    byeWeek: null, source: "draft"
  })) };
}

describe("draft scoring helpers", () => {
  it("rewards a player who falls below ADP", () => {
    expect(computeAdpValue(60, 30)).toBeGreaterThan(computeAdpValue(30, 30));
  });

  it("penalizes a player drafted far earlier than ADP", () => {
    expect(computeAdpValue(20, 60)).toBeLessThan(50);
  });

  it("treats missing ADP as market-neutral for skill positions", () => {
    expect(computeAdpValue(21, null, "RB")).toBe(50);
  });

  it("penalizes missing ADP for backup-tier positions", () => {
    expect(computeAdpValue(21, null, "QB")).toBeLessThan(50);
    expect(computeAdpValue(21, null, "K")).toBeLessThan(50);
    expect(computeAdpValue(21, null, "DST")).toBeLessThan(50);
  });

  it("recognizes greater wait risk when next pick is far later", () => {
    expect(computeNextPickRisk(35, 67, 45)).toBeGreaterThan(computeNextPickRisk(30, 35, 45));
  });

  it("reduces WR/RB roster need as starters fill", () => {
    const empty = state();
    const filledWr = state({
      roster: {
        players: [
          { playerId: "a", name: "A", position: "WR", byeWeek: 6, source: "draft" },
          { playerId: "b", name: "B", position: "WR", byeWeek: 7, source: "draft" },
          { playerId: "c", name: "C", position: "WR", byeWeek: 8, source: "draft" }
        ]
      }
    });
    expect(computeRosterNeed("WR", empty, league, strategy)).toBeGreaterThan(
      computeRosterNeed("WR", filledWr, league, strategy)
    );
    const oneRb = state({
      roster: { players: [{ playerId: "r", name: "R", position: "RB", byeWeek: 5, source: "keeper" }] }
    });
    const twoRb = state({
      roster: {
        players: [
          { playerId: "r", name: "R", position: "RB", byeWeek: 5, source: "keeper" },
          { playerId: "r2", name: "R2", position: "RB", byeWeek: 9, source: "draft" }
        ]
      }
    });
    expect(computeRosterNeed("RB", oneRb, league, strategy)).toBeGreaterThan(
      computeRosterNeed("RB", twoRb, league, strategy)
    );
  });
});

describe("shortlist scoring", () => {
  it("penalizes K/DST early and excludes them from the shortlist", () => {
    const k = player({ id: "k::K", name: "Late Kicker", position: "K", sportslineRating: 100, adp: 20 });
    const wr = player({ id: "w::WR", name: "Receiver", position: "WR", sportslineRating: 70, adp: 25 });
    const current = state({
      currentOverallPick: 21,
      availablePlayerIds: new Set([k.id, wr.id])
    });
    const scored = scoreCandidates([k, wr], current, league, strategy);
    const kicker = scored.find((c) => c.player.position === "K");
    expect(kicker).toBeTruthy();
    expect(kicker!.components.penalties).toBeGreaterThan(0);
    expect(kicker!.score).toBeLessThan(scored.find((c) => c.player.position === "WR")!.score);

    const shortlist = generateShortlist([k, wr], current, league, strategy);
    expect(shortlist.every((c) => c.player.position !== "K" && c.player.position !== "DST")).toBe(true);
  });

  it("hard-excludes players who would exceed roster maximums", () => {
    const limited: LeagueConfig = {
      ...league,
      rosterMaximums: { ...league.rosterMaximums, WR: 3 }
    };
    const wrs: LivePlayer[] = [
      player({ id: "wr1::WR", name: "WR One", position: "WR" }),
      player({ id: "wr2::WR", name: "WR Two", position: "WR" })
    ];
    const rb = player({ id: "rb1::RB", name: "RB One", position: "RB" });
    const current = state({
      roster: {
        players: [
          { playerId: "a", name: "A", position: "WR", byeWeek: 6, source: "draft" },
          { playerId: "b", name: "B", position: "WR", byeWeek: 7, source: "draft" },
          { playerId: "c", name: "C", position: "WR", byeWeek: 8, source: "draft" }
        ]
      },
      availablePlayerIds: new Set([...wrs.map((p) => p.id), rb.id])
    });
    const shortlist = generateShortlist([...wrs, rb], current, limited, strategy);
    expect(shortlist.every((c) => c.player.position !== "WR")).toBe(true);
    expect(shortlist.some((c) => c.player.position === "RB")).toBe(true);
  });

  it("is deterministic for the same state and config", () => {
    const pool = [
      player({ id: "a::WR", name: "Alpha", position: "WR", sportslineRating: 88, adp: 22 }),
      player({ id: "b::RB", name: "Bravo", position: "RB", sportslineRating: 81, adp: 28 }),
      player({ id: "c::TE", name: "Charlie", position: "TE", sportslineRating: 90, adp: 40 })
    ];
    const current = state({
      availablePlayerIds: new Set(pool.map((p) => p.id))
    });
    const first = generateShortlist(pool, current, league, strategy).map((c) => [
      c.player.id,
      c.score,
      c.notes.join("|")
    ]);
    const second = generateShortlist(pool, current, league, strategy).map((c) => [
      c.player.id,
      c.score,
      c.notes.join("|")
    ]);
    expect(first).toEqual(second);
  });

  it("includes explainable component notes", () => {
    const wr = player({ id: "w::WR", name: "Receiver", position: "WR", sportslineRating: 75, adp: 27.3 });
    const current = state({ availablePlayerIds: new Set([wr.id]) });
    const [top] = generateShortlist([wr], current, league, strategy);
    expect(top!.notes.join(" ")).toMatch(/sportslineRating=/);
    expect(top!.notes.join(" ")).toMatch(/adpValue=/);
    expect(top!.notes.join(" ")).toMatch(/rosterNeed=/);
    expect(top!.notes.join(" ")).toMatch(/contrib=/);
  });

  it("does not let a small bye overlap dominate talent", () => {
    const elite = player({
      id: "elite::WR",
      name: "Elite",
      position: "WR",
      sportslineRating: 93,
      adp: 20,
      byeWeek: 11
    });
    const lesser = player({
      id: "lesser::WR",
      name: "Lesser",
      position: "WR",
      sportslineRating: 55,
      adp: 20,
      byeWeek: 6
    });
    const current = state({
      roster: {
        players: [
          { playerId: "x", name: "X", position: "WR", byeWeek: 11, source: "keeper" },
          { playerId: "y", name: "Y", position: "RB", byeWeek: 11, source: "draft" }
        ]
      },
      availablePlayerIds: new Set([elite.id, lesser.id])
    });
    const shortlist = generateShortlist([elite, lesser], current, league, strategy);
    expect(shortlist[0]!.player.id).toBe(elite.id);
    expect(shortlist[0]!.components.penalties).toBeGreaterThan(0);
    expect(shortlist[0]!.components.penalties).toBeLessThanOrEqual(8);
  });
});

describe("starter-first shortlist", () => {
  it.each(["QB", "TE", "WR"] as const)("fills RB2 before a higher-rated %s backup", (position) => {
    const backup = player({ id: "backup", name: "Backup", position, sportslineRating: 100, adp: 1 });
    const rb = player({ id: "rb", name: "Starter RB", position: "RB", sportslineRating: 45, adp: 90 });
    const current = state({
      roster: roster("QB", "RB", "WR", "WR", "WR", "TE"),
      availablePlayerIds: new Set([backup.id, rb.id])
    });
    const ranked = generateShortlist([backup, rb], current, league, strategy);
    expect(ranked.map((candidate) => candidate.player.id)).toEqual([rb.id]);
    expect(ranked[0]!.notes.join(" ")).toMatch(/starter.*before.*depth/i);
  });

  it("keeps SportsLine scoring intact among players who fill starter openings", () => {
    const higher = player({ id: "higher", name: "Higher SportsLine", position: "RB", sportslineRating: 80, adp: 60 });
    const lower = player({ id: "lower", name: "Lower SportsLine", position: "RB", sportslineRating: 45, adp: 50 });
    const current = state({ roster: roster("RB"), availablePlayerIds: new Set([higher.id, lower.id]) });
    const ranked = generateShortlist([lower, higher], current, league, strategy);
    const scored = scoreCandidates([lower, higher], current, league, strategy);
    expect(ranked[0]!.player.id).toBe(higher.id);
    expect(ranked.map(({ player, score, components }) => ({ id: player.id, score, components })))
      .toEqual(scored.map(({ player, score, components }) => ({ id: player.id, score, components })));
  });

  it("uses configured starter counts rather than assuming every league starts one QB", () => {
    const qb = player({ id: "qb", name: "Second Starting QB", position: "QB" });
    const wr = player({ id: "wr", name: "Backup WR", position: "WR", sportslineRating: 100 });
    const current = state({
      roster: roster("QB", "RB", "RB", "WR", "WR", "WR", "TE"),
      availablePlayerIds: new Set([qb.id, wr.id])
    });
    const twoQbLeague = { ...league, lineup: { ...league.lineup, QB: 2 } };
    expect(generateShortlist([qb, wr], current, twoQbLeague, strategy).map((candidate) => candidate.player.id)).toEqual([qb.id]);
  });

  it("allows valuable first QB/TE backups after core starters fill, even with K/DST deferred", () => {
    const pool = [
      player({ id: "qb", name: "Backup QB", position: "QB", sportslineRating: 100 }),
      player({ id: "te", name: "Backup TE", position: "TE", sportslineRating: 95 }),
      player({ id: "rb", name: "Depth RB", position: "RB", sportslineRating: 20 }),
      player({ id: "k", name: "Kicker", position: "K", sportslineRating: 100 })
    ];
    const current = state({
      currentOverallPick: 99,
      roster: roster("QB", "RB", "RB", "WR", "WR", "WR", "TE"),
      availablePlayerIds: new Set(pool.map((player) => player.id))
    });
    const ranked = generateShortlist(pool, current, league, strategy);
    expect(ranked.map((candidate) => candidate.player.id)).toEqual(expect.arrayContaining(["qb", "te", "rb"]));
    expect(ranked.some((candidate) => candidate.player.position === "K")).toBe(false);
    expect(ranked[0]!.player.id).toBe("qb");
  });

  it("prefers RB/WR depth to third QBs/TEs and spare kickers/defenses", () => {
    const pool = (["QB", "TE", "K", "DST", "RB", "WR"] as const).map((position) => player({
      id: position, name: position, position, sportslineRating: position === "RB" || position === "WR" ? 30 : 100
    }));
    const current = state({
      currentOverallPick: 158,
      roster: roster("QB", "QB", "RB", "RB", "WR", "WR", "WR", "TE", "TE", "K", "DST"),
      availablePlayerIds: new Set(pool.map((player) => player.id))
    });
    expect(generateShortlist(pool, current, league, strategy).map((candidate) => candidate.player.position).sort())
      .toEqual(["RB", "WR"]);
  });

  it("fills K/DST starters once eligible instead of selecting more bench players", () => {
    const pool = [
      player({ id: "wr", name: "Depth WR", position: "WR", sportslineRating: 100 }),
      player({ id: "k", name: "Kicker", position: "K", sportslineRating: 40 }),
      player({ id: "dst", name: "Defense", position: "DST", sportslineRating: 40 })
    ];
    const current = state({
      currentOverallPick: strategy.kDstEligibleAfterOverallPick,
      roster: roster("QB", "RB", "RB", "WR", "WR", "WR", "TE"),
      availablePlayerIds: new Set(pool.map((player) => player.id))
    });
    expect(generateShortlist(pool, current, league, strategy).map((candidate) => candidate.player.position).sort())
      .toEqual(["DST", "K"]);
  });

  it("does not deadlock when no missing starter position has an eligible player", () => {
    const qb = player({ id: "qb", name: "Backup QB", position: "QB" });
    const rb = player({ id: "rb", name: "Taken RB", position: "RB", available: false });
    const current = state({ roster: roster("QB"), availablePlayerIds: new Set([qb.id]) });
    expect(generateShortlist([qb, rb], current, league, strategy)[0]!.player.id).toBe(qb.id);
  });
});

describe("strategy config", () => {
  it("loads current strategy weights that sum to 1", () => {
    const cfg: StrategyConfig = strategy;
    const sum = Object.values(cfg.weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 3);
    expect(cfg.kDstEligibleAfterOverallPick).toBe(130);
  });
});
