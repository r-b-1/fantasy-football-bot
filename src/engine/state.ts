import { configConflict } from "../domain/errors.js";
import type {
  DraftFixture,
  DraftPickEvent,
  DraftState,
  FixtureKeeper,
  LeagueConfig,
  LivePlayer,
  Position,
  SportslinePlayer,
  StrategyConfig
} from "../domain/types.js";
import { requirePlayer } from "./identity.js";

export function nextUserOverallPick(
  currentOverallPick: number,
  knownOverallPicks: number[]
): number | null {
  const upcoming = knownOverallPicks
    .filter((pick) => pick > currentOverallPick)
    .sort((a, b) => a - b);
  return upcoming[0] ?? null;
}

export function toLivePlayers(
  players: SportslinePlayer[],
  unavailableIds: Set<string>
): LivePlayer[] {
  return players.map((player) => ({
    ...player,
    available: !unavailableIds.has(player.id)
  }));
}

function recentPositionCounts(
  events: DraftPickEvent[],
  window: number
): Partial<Record<Position, number>> {
  const counts: Partial<Record<Position, number>> = {};
  for (const event of events.slice(-window)) {
    if (!event.position) continue;
    counts[event.position] = (counts[event.position] ?? 0) + 1;
  }
  return counts;
}

function keeperKey(keeper: { name: string; position: Position }): string {
  return `${keeper.name.toLowerCase()}::${keeper.position}`;
}

export function unavailableIdsFromFixture(
  players: SportslinePlayer[],
  fixture: DraftFixture
): { unavailableIds: Set<string>; events: DraftPickEvent[] } {
  const unavailableIds = new Set<string>();
  const events: DraftPickEvent[] = [];

  for (const keeper of fixture.keepers) {
    const player = requirePlayer(players, keeper.name, keeper.position);
    unavailableIds.add(player.id);
  }

  const drafted = [...fixture.drafted].sort((a, b) => a.overallPick - b.overallPick);
  for (const pick of drafted) {
    const player = requirePlayer(players, pick.playerName, pick.position);
    unavailableIds.add(player.id);
    events.push({
      overallPick: pick.overallPick,
      fantasyTeam: pick.fantasyTeam,
      playerId: player.id,
      playerName: player.name,
      position: player.position,
      nflTeam: pick.nflTeam,
      observedAt: "fixture"
    });
  }

  return { unavailableIds, events };
}

export function assertFixtureMatchesLeague(fixture: DraftFixture, league: LeagueConfig): void {
  const conflicts: string[] = [];
  const userKeepers = fixture.keepers.filter(
    (keeper) => keeper.fantasyTeam === league.userTeamName
  );
  const expected = [...league.keepers].sort((a, b) => keeperKey(a).localeCompare(keeperKey(b)));
  const actual = [...userKeepers].sort((a, b) => keeperKey(a).localeCompare(keeperKey(b)));

  if (expected.length !== actual.length) {
    conflicts.push(
      `Fixture user keepers (${actual.map((k) => k.name).join(", ") || "none"}) do not match league.current.json (${expected.map((k) => k.name).join(", ")})`
    );
  } else {
    for (let i = 0; i < expected.length; i += 1) {
      if (keeperKey(expected[i]!) !== keeperKey(actual[i]!)) {
        conflicts.push(
          `Fixture user keeper ${actual[i]?.name} ${actual[i]?.position} does not match league keeper ${expected[i]?.name} ${expected[i]?.position}`
        );
      }
    }
  }

  const onClock = fixture.teamOnClock;
  if (
    onClock &&
    league.knownOverallPicks.includes(fixture.currentOverallPick) &&
    onClock !== league.userTeamName
  ) {
    conflicts.push(
      `Fixture teamOnClock "${onClock}" at overall pick ${fixture.currentOverallPick} contradicts known user pick inventory in league.current.json. Live CBS data must be used to update the config explicitly.`
    );
  }

  if (conflicts.length > 0) throw configConflict(conflicts);
}

export function buildDraftStateFromFixture(
  players: SportslinePlayer[],
  fixture: DraftFixture,
  league: LeagueConfig,
  strategy: StrategyConfig
): { state: DraftState; livePlayers: LivePlayer[] } {
  assertFixtureMatchesLeague(fixture, league);
  const { unavailableIds, events } = unavailableIdsFromFixture(players, fixture);

  const userKeeperPlayers = fixture.keepers
    .filter((keeper) => keeper.fantasyTeam === league.userTeamName)
    .map((keeper) => {
      const player = requirePlayer(players, keeper.name, keeper.position);
      return {
        playerId: player.id,
        name: player.name,
        position: player.position,
        byeWeek: player.byeWeek,
        source: "keeper" as const
      };
    });

  const userDrafted = events
    .filter((event) => event.fantasyTeam === league.userTeamName)
    .map((event) => {
      const player = players.find((p) => p.id === event.playerId);
      return {
        playerId: event.playerId,
        name: event.playerName,
        position: event.position ?? player?.position ?? "WR",
        byeWeek: player?.byeWeek ?? null,
        source: "draft" as const
      };
    });

  const teamOnClock =
    fixture.teamOnClock ??
    (league.knownOverallPicks.includes(fixture.currentOverallPick) ? league.userTeamName : null);

  const warnings: string[] = [];
  if (league.knownPicksArePartial) {
    warnings.push("knownOverallPicks are partial and must be re-read from CBS before live use.");
  }
  if (league.draftTypeVerificationRequired) {
    warnings.push("draftType is assumed snake and still requires live CBS verification.");
  }
  const extraKeepers = fixture.keepers.filter((k) => k.fantasyTeam !== league.userTeamName);
  if (extraKeepers.length > 0) {
    warnings.push(
      `Fixture includes ${extraKeepers.length} non-user keeper(s) that are not official league-wide keepers in config.`
    );
  }

  const state: DraftState = {
    currentOverallPick: fixture.currentOverallPick,
    nextUserOverallPick: nextUserOverallPick(fixture.currentOverallPick, league.knownOverallPicks),
    teamOnClock,
    isUserTurn: teamOnClock === league.userTeamName,
    clockSecondsRemaining: null,
    snapshotAt: "fixture",
    roster: { players: [...userKeeperPlayers, ...userDrafted] },
    draftEvents: events,
    availablePlayerIds: new Set(
      players.filter((player) => !unavailableIds.has(player.id)).map((player) => player.id)
    ),
    recentPositionCounts: recentPositionCounts(events, strategy.recentPickWindow),
    warnings
  };

  return {
    state,
    livePlayers: toLivePlayers(players, unavailableIds)
  };
}

export function keeperUnavailableIds(
  players: SportslinePlayer[],
  keepers: FixtureKeeper[] | LeagueConfig["keepers"]
): Set<string> {
  return new Set(
    keepers.map((keeper) => requirePlayer(players, keeper.name, keeper.position).id)
  );
}
