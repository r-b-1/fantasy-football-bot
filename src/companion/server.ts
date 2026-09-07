import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadLeagueConfig,
  loadStrategyConfig
} from "../config/load.js";
import { loadSportslineWorkbook } from "../data/sportsline.js";
import { loadRosterGrid } from "../data/rosterGrid.js";
import { resolveProjectionKeepers } from "../data/leagueKeepers.js";
import {
  compareFantasyProsRankings,
  importFantasyProsRankingsCsv,
  type FantasyProsRanking
} from "../data/fantasyProsRankings.js";
import {
  nextUserOverallPick,
  snakeDraftSlot,
  toLivePlayers
} from "../engine/state.js";
import { playerKey, teamNameKey, normalizePlayerName } from "../data/normalize.js";
import { generateShortlist } from "../engine/shortlist.js";
import type {
  DraftState,
  LeagueConfig,
  LivePlayer,
  Position,
  SportslinePlayer,
  StrategyConfig
} from "../domain/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PUBLIC_DIR = join(__dirname, "..", "..", "public");
const COMPANION_DIR = join(PUBLIC_DIR, "companion");

interface KeeperRef { fantasyTeam: string; name: string; position: Position }

interface SessionState {
  league: LeagueConfig;
  strategy: StrategyConfig;
  slPool: LivePlayer[];
  fpPool: LivePlayer[];
  fpRankById: Map<string, number>;
  slById: Map<string, SportslinePlayer>;
  teamIndex: Map<string, string>;
  allKeepers: KeeperRef[];
  draftedPicks: { overallPick: number; fantasyTeam: string; playerId: string; playerName: string; position: Position }[];
  draftEvents: DraftPickEvent[];
  source: "sportsline" | "fantasypros";
}

let session: SessionState | null = null;

function readJson<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendText(res: ServerResponse, status: number, body: string, contentType = "text/plain"): void {
  res.writeHead(status, { "content-type": contentType, "content-length": Buffer.byteLength(body), "cache-control": "no-store" });
  res.end(body);
}

function pickOwnerAt(league: LeagueConfig, overallPick: number, teamIndex: Map<string, string>): string {
  for (const assignment of league.leaguePicks ?? []) {
    if (assignment.picks.includes(overallPick)) {
      return teamIndex.get(teamNameKey(assignment.teamName)) ?? assignment.teamName;
    }
  }
  const slot = snakeDraftSlot(overallPick, league.teamCount);
  const order = league.draftOrder;
  if (!order || order.length !== league.teamCount) {
    throw new Error(`No draftOrder for pick ${overallPick}`);
  }
  const canonical = order[slot - 1]!;
  return teamIndex.get(teamNameKey(canonical)) ?? canonical;
}

function applyFPRatings(sl: SportslinePlayer[], fp: FantasyProsRanking[]): SportslinePlayer[] {
  const lookup = new Map<string, number>();
  for (const r of fp) lookup.set(playerKey(r.name, r.position), r.ecrRank);
  const max = Math.max(...fp.map((r) => r.ecrRank));
  return sl.map((p) => {
    const ecr = lookup.get(p.id);
    if (ecr == null) return { ...p, sportslineRating: 0 };
    const rating = Math.round((1 - (ecr - 1) / Math.max(1, max - 1)) * 100);
    return { ...p, sportslineRating: rating };
  });
}

// Same operator-confirmed ambiguous initials used by the rich fixture loader.
const ROSTER_ALIASES: Record<string, string> = {
  "b robinson::RB": "Bijan Robinson",
  "t etienne::RB": "Travis Etienne"
};

function resolveRosterName(name: string, position: Position, slPlayers: SportslinePlayer[]): SportslinePlayer {
  const nameKey = (value: string) => normalizePlayerName(value).toLowerCase().replace(/[.'-]/g, "");
  const key = nameKey(ROSTER_ALIASES[playerKey(name, position)] ?? name);
  const exact = slPlayers.filter((p) => p.position === position && nameKey(p.name) === key);
  const matches = exact.length ? exact : slPlayers.filter((p) => {
    const candidate = nameKey(p.name);
    return p.position === position && candidate[0] === key[0] &&
      candidate.slice(candidate.indexOf(" ")) === key.slice(key.indexOf(" "));
  });
  if (matches.length !== 1) {
    throw new Error(`Cannot uniquely resolve keeper "${name}" (${position})`);
  }
  return matches[0]!;
}

function buildSession(): SessionState {
  const league = loadLeagueConfig(process.env.LEAGUE_CONFIG ?? "config/league.current.json");
  const strategy = loadStrategyConfig(process.env.STRATEGY_CONFIG ?? "config/strategy.current.json");
  const slPlayers = loadSportslineWorkbook(process.env.SPORTSLINE_XLSX ?? "data/reference/cheatsheet_cbsppr12.xlsx");
  const fp = importFantasyProsRankingsCsv(process.env.FANTASY_PROS_RANKINGS_CSV ?? "FantasyPros_2026_Draft_ALL_Rankings.csv");

  const teamIndex = new Map<string, string>();
  for (const c of league.draftOrder ?? []) teamIndex.set(teamNameKey(c), c);
  for (const a of league.leaguePicks ?? []) teamIndex.set(teamNameKey(a.teamName), a.teamName);

  const allKeepers: KeeperRef[] = [];
  const keeperOwners = new Map<string, string>();
  const rosterGridPath = process.env.COMPANION_ROSTERGRID_CSV ?? league.rosterGridPath;
  const addKeeper = (fantasyTeam: string, name: string, position: Position): void => {
    const canonical = teamIndex.get(teamNameKey(fantasyTeam));
    if (!canonical) throw new Error(`Unknown keeper team "${fantasyTeam}"`);
    const player = resolveRosterName(name, position, slPlayers);
    const owner = keeperOwners.get(player.id);
    if (owner) {
      if (rosterGridPath || owner !== canonical) {
        throw new Error(`Duplicate keeper "${player.name}" for ${owner} and ${canonical}`);
      }
      return;
    }
    keeperOwners.set(player.id, canonical);
    allKeepers.push({ fantasyTeam: canonical, name: player.name, position: player.position });
  };

  // A configured grid is exclusive: neither JSON/config keepers nor trades override it.
  if (rosterGridPath) {
    const grid = loadRosterGrid(rosterGridPath);
    const seenTeams = new Set<string>();
    for (const team of grid.teams) {
      const canonical = teamIndex.get(teamNameKey(team.teamName));
      if (!canonical) throw new Error(`Unknown keeper team "${team.teamName}"`);
      if (seenTeams.has(canonical)) throw new Error(`Duplicate keeper team "${canonical}"`);
      seenTeams.add(canonical);
      const before = allKeepers.length;
      for (const [position, entries] of Object.entries(team.starters)) {
        for (const entry of entries) {
          addKeeper(canonical, entry.name, position as Position);
        }
      }
      if (allKeepers.length - before !== league.keeperSlots) {
        throw new Error(`Expected ${league.keeperSlots} keepers for ${canonical}`);
      }
    }
    if (seenTeams.size !== league.teamCount) {
      throw new Error(`Expected ${league.teamCount} keeper teams, got ${seenTeams.size}`);
    }
  } else {
    for (const keeper of resolveProjectionKeepers(league)) {
      addKeeper(keeper.fantasyTeam, keeper.playerName, keeper.position);
    }
  }

  // Reject invalid keeper data before doing the more expensive provider comparison.
  const comparison = compareFantasyProsRankings(fp.players, slPlayers);
  const fpRankById = new Map(comparison.matches.map((row) => [row.sportsline!.id, row.fantasyPros.ecrRank]));
  const slPool = toLivePlayers(slPlayers, new Set());
  for (const p of slPool) p.available = true;
  const fpPool = toLivePlayers(applyFPRatings(slPlayers, fp.players), new Set());
  for (const p of fpPool) p.available = true;

  const slById = new Map<string, SportslinePlayer>(slPlayers.map((p) => [p.id, p]));

  return {
    league,
    strategy,
    slPool,
    fpPool,
    fpRankById,
    slById,
    teamIndex,
    allKeepers,
    draftedPicks: [],
    draftEvents: [],
    source: "fantasypros"
  };
}

function applyKeeperExclusions(session: SessionState): void {
  const unavailableKeys = new Set(session.allKeepers.map((k) => playerKey(k.name, k.position)));
  for (const p of session.slPool) p.available = !unavailableKeys.has(p.id);
  for (const p of session.fpPool) p.available = !unavailableKeys.has(p.id);
}

function getSession(): SessionState {
  if (!session) {
    session = buildSession();
    applyKeeperExclusions(session);
  }
  return session;
}

function currentLivePool(s: SessionState): LivePlayer[] {
  return s.source === "sportsline" ? s.slPool : s.fpPool;
}

function buildDraftState(s: SessionState): DraftState {
  const overallPick = s.draftedPicks.length + 1;
  const livePlayers = currentLivePool(s);
  const teamOnClock = pickOwnerAt(s.league, overallPick, s.teamIndex);
  const userRoster: { name: string; position: Position; source: "keeper" | "draft" }[] = [];
  for (const k of s.allKeepers) {
    if (teamNameKey(k.fantasyTeam) === teamNameKey(s.league.userTeamName)) {
      userRoster.push({ name: k.name, position: k.position, source: "keeper" });
    }
  }
  for (const ev of s.draftEvents) {
    if (teamNameKey(ev.fantasyTeam) === teamNameKey(s.league.userTeamName)) {
      userRoster.push({ name: ev.playerName, position: ev.position, source: "draft" });
    }
  }
  const recent = s.draftEvents.slice(-s.strategy.recentPickWindow);
  const recentPositionCounts: Partial<Record<Position, number>> = {};
  for (const e of recent) if (e.position) recentPositionCounts[e.position] = (recentPositionCounts[e.position] ?? 0) + 1;
  return {
    currentOverallPick: overallPick,
    nextUserOverallPick: nextUserOverallPick(overallPick, s.league.knownOverallPicks),
    teamOnClock,
    isUserTurn: teamOnClock === s.league.userTeamName,
    clockSecondsRemaining: null,
    snapshotAt: new Date().toISOString(),
    roster: {
      players: userRoster.map((p) => {
        const lp = livePlayers.find((lp) => lp.name === p.name && lp.position === p.position);
        return {
          playerId: lp?.id ?? `unknown::${p.position}`,
          name: p.name,
          position: p.position,
          byeWeek: lp?.byeWeek ?? null,
          source: p.source
        };
      })
    },
    draftEvents: s.draftEvents,
    availablePlayerIds: new Set(livePlayers.filter((p) => p.available).map((p) => p.id)),
    recentPositionCounts,
    warnings: []
  };
}

interface DraftPickEvent {
  overallPick: number;
  fantasyTeam: string;
  playerId: string;
  playerName: string;
  position: Position;
  observedAt: string;
}

async function tryServeStatic(req: IncomingMessage, res: ServerResponse, urlPath: string): Promise<boolean> {
  if (req.method !== "GET") return false;
  if (urlPath === "/" || urlPath === "/index.html") {
    const html = await readFile(join(COMPANION_DIR, "index.html"));
    sendText(res, 200, html.toString("utf8"), "text/html; charset=utf-8");
    return true;
  }
  if (urlPath === "/style.css") {
    const css = await readFile(join(COMPANION_DIR, "style.css"));
    sendText(res, 200, css.toString("utf8"), "text/css; charset=utf-8");
    return true;
  }
  if (urlPath === "/app.js") {
    const js = await readFile(join(COMPANION_DIR, "app.js"));
    sendText(res, 200, js.toString("utf8"), "application/javascript; charset=utf-8");
    return true;
  }
  return false;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  try {
    if (req.method === "GET" && (await tryServeStatic(req, res, path))) return;

    if (req.method === "GET" && path === "/api/state") {
      const s = getSession();
      const livePlayers = currentLivePool(s);
      const state = buildDraftState(s);
      sendJson(res, 200, {
        source: s.source,
        leagueName: s.league.leagueName,
        userTeamName: s.league.userTeamName,
        teamCount: s.league.teamCount,
        lineup: s.league.lineup,
        keepers: s.allKeepers,
        knownOverallPicks: s.league.knownOverallPicks,
        round: Math.ceil(state.currentOverallPick / s.league.teamCount),
        upcomingPicks: Array.from({ length: 6 }, (_, index) => {
          const overallPick = state.currentOverallPick + index;
          return { overallPick, fantasyTeam: pickOwnerAt(s.league, overallPick, s.teamIndex) };
        }),
        currentOverallPick: state.currentOverallPick,
        teamOnClock: state.teamOnClock,
        isUserTurn: state.isUserTurn,
        nextUserOverallPick: state.nextUserOverallPick,
        userRoster: state.roster.players.map((p) => ({ name: p.name, position: p.position, source: p.source })),
        draftedCount: s.draftedPicks.length,
        picks: s.draftedPicks.map((p) => ({
          overallPick: p.overallPick,
          fantasyTeam: p.fantasyTeam,
          playerId: p.playerId,
          playerName: p.playerName,
          position: p.position
        })),
        availablePlayers: livePlayers
          .filter((p) => p.available)
          .map((p) => ({
            id: p.id, name: p.name, position: p.position, adp: p.adp,
            rating: p.sportslineRating,
            sportslineRating: s.slById.get(p.id)!.sportslineRating,
            fantasyProsRank: s.fpRankById.get(p.id) ?? null
          }))
      });
      return;
    }

    if (req.method === "POST" && path === "/api/source") {
      const s = getSession();
      const body = await readJson<{ source: "sportsline" | "fantasypros" }>(req);
      s.source = body.source === "sportsline" ? "sportsline" : "fantasypros";
      sendJson(res, 200, { ok: true, source: s.source });
      return;
    }

    if (req.method === "POST" && path === "/api/picks") {
      const s = getSession();
      const body = await readJson<{ playerId?: string; playerName?: string; position?: Position; expectedOverallPick?: number }>(req);
      const livePlayers = currentLivePool(s);
      const overallPick = s.draftedPicks.length + 1;
      if (body.expectedOverallPick !== undefined && body.expectedOverallPick !== overallPick) {
        sendJson(res, 409, { ok: false, error: "Draft has advanced. Refresh state before recording a pick.", currentOverallPick: overallPick });
        return;
      }
      const teamOnClock = pickOwnerAt(s.league, overallPick, s.teamIndex);
      let player: LivePlayer | undefined;
      if (body.playerId) {
        player = livePlayers.find((p) => p.id === body.playerId && p.available);
      } else if (body.playerName && body.position) {
        const targetKey = playerKey(body.playerName, body.position);
        player = livePlayers.find((p) => p.id === targetKey && p.available);
      }
      if (!player) {
        sendJson(res, 400, { ok: false, error: "Player not found or unavailable." });
        return;
      }
      player.available = false;
      for (const p of (s.source === "sportsline" ? s.fpPool : s.slPool)) {
        if (p.id === player.id) p.available = false;
      }
      const event: DraftPickEvent = {
        overallPick,
        fantasyTeam: teamOnClock,
        playerId: player.id,
        playerName: player.name,
        position: player.position,
        observedAt: "manual"
      };
      s.draftedPicks.push({
        overallPick,
        fantasyTeam: teamOnClock,
        playerId: player.id,
        playerName: player.name,
        position: player.position
      });
      s.draftEvents.push(event);
      sendJson(res, 200, { ok: true, pick: { overallPick, fantasyTeam: teamOnClock, playerName: player.name, position: player.position } });
      return;
    }

    if (req.method === "POST" && path === "/api/undo") {
      const s = getSession();
      const last = s.draftedPicks.pop();
      s.draftEvents.pop();
      if (last) {
        for (const p of s.slPool) if (p.id === last.playerId) p.available = true;
        for (const p of s.fpPool) if (p.id === last.playerId) p.available = true;
      }
      sendJson(res, 200, { ok: true, undone: last ?? null });
      return;
    }

    if (req.method === "POST" && path === "/api/reset") {
      session = null;
      getSession();
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && path === "/api/recommend") {
      const s = getSession();
      const state = buildDraftState(s);
      const livePlayers = currentLivePool(s);
      const ranked = generateShortlist(livePlayers, state, s.league, s.strategy);
      sendJson(res, 200, {
        source: s.source,
        currentOverallPick: state.currentOverallPick,
        teamOnClock: state.teamOnClock,
        isUserTurn: state.isUserTurn,
        nextUserOverallPick: state.nextUserOverallPick,
        recommendations: ranked.slice(0, 10).map((c) => ({
          rank: 0,
          playerId: c.player.id,
          playerName: c.player.name,
          position: c.player.position,
          team: c.player.nflTeam ?? null,
          score: c.score,
          notes: c.notes,
          components: c.components
        })).map((c, i) => ({ ...c, rank: i + 1 }))
      });
      return;
    }

    sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { ok: false, error: message });
  }
}

export function startCompanionServer(port = 4000): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      void handleRequest(req, res);
    });
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      console.log(`Companion UI: http://localhost:${actualPort}/`);
      resolve({
        port: actualPort,
        close: () => server.close()
      });
    });
  });
}
