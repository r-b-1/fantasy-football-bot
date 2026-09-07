import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { playerKey } from "../data/normalize.js";
import { generateShortlist } from "../engine/shortlist.js";
import type { DraftPickEvent, Position } from "../domain/types.js";
import { CompanionRoomBridge, RoomConnectSchema } from "./roomBridge.js";
import {
  buildDraftState,
  buildSession,
  currentLivePool,
  pickOwnerAt,
  serializeCompanionState,
  type SessionState
} from "./session.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PUBLIC_DIR = join(__dirname, "..", "..", "public");
const COMPANION_DIR = join(PUBLIC_DIR, "companion");

export interface CompanionServerOptions {
  liveAllowed?: boolean;
  fixtureHeadless?: boolean;
  autoConnect?: "fixture" | "live" | null;
}

export interface CompanionServerHandle {
  port: number;
  close: () => void;
  stop: () => Promise<void>;
}

function resolveOptions(options: CompanionServerOptions = {}) {
  const inVitest = process.env.VITEST === "true";
  const envRoom = process.env.COMPANION_ROOM;
  return {
    liveAllowed: options.liveAllowed ?? !inVitest,
    fixtureHeadless:
      options.fixtureHeadless ?? (process.env.COMPANION_FIXTURE_HEADLESS === "1" || inVitest),
    autoConnect:
      options.autoConnect ??
      (envRoom === "fixture" || envRoom === "live" ? envRoom : null)
  };
}

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
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  res.end(body);
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

const ROOM_BUSY_ERROR = "The draft room is attached. Disconnect to record picks locally.";

export function startCompanionServer(
  port = 4000,
  options: CompanionServerOptions = {}
): Promise<CompanionServerHandle> {
  const resolved = resolveOptions(options);
  let session: SessionState | null = null;
  const getSession = (): SessionState => {
    if (!session) session = buildSession();
    return session;
  };
  const room = new CompanionRoomBridge(getSession, {
    liveAllowed: resolved.liveAllowed,
    fixtureHeadless: resolved.fixtureHeadless
  });

  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    try {
      if (req.method === "GET" && (await tryServeStatic(req, res, path))) return;

      if (req.method === "GET" && path === "/api/state") {
        sendJson(res, 200, serializeCompanionState(getSession(), room.publicStatus()));
        return;
      }

      if (req.method === "GET" && path === "/api/room") {
        sendJson(res, 200, room.publicStatus());
        return;
      }

      if (req.method === "POST" && path === "/api/room/connect") {
        const parsed = RoomConnectSchema.safeParse(await readJson(req));
        if (!parsed.success) {
          sendJson(res, 400, { ok: false, error: "Invalid room connect request." });
          return;
        }
        if (parsed.data.source === "live" && !room.publicStatus().liveAllowed) {
          sendJson(res, 403, { ok: false, error: "Live CBS attach is disabled in this companion process." });
          return;
        }
        const status = await room.connect(parsed.data);
        sendJson(res, 200, { ok: true, room: status });
        return;
      }

      if (req.method === "POST" && path === "/api/room/disconnect") {
        const status = await room.disconnect();
        sendJson(res, 200, { ok: true, room: status });
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
        const roomStatus = room.publicStatus();
        if (!roomStatus.writable) {
          sendJson(res, 409, {
            ok: false,
            error: ROOM_BUSY_ERROR,
            currentOverallPick: getSession().draftedPicks.length + 1
          });
          return;
        }
        const s = getSession();
        const body = await readJson<{
          playerId?: string;
          playerName?: string;
          position?: Position;
          expectedOverallPick?: number;
        }>(req);
        const livePlayers = currentLivePool(s);
        const overallPick = s.draftedPicks.length + 1;
        if (body.expectedOverallPick !== undefined && body.expectedOverallPick !== overallPick) {
          sendJson(res, 409, {
            ok: false,
            error: "Draft has advanced. Refresh state before recording a pick.",
            currentOverallPick: overallPick
          });
          return;
        }
        const teamOnClock = pickOwnerAt(s.league, overallPick, s.teamIndex);
        let player = body.playerId
          ? livePlayers.find((candidate) => candidate.id === body.playerId && candidate.available)
          : undefined;
        if (!player && body.playerName && body.position) {
          const targetKey = playerKey(body.playerName, body.position);
          player = livePlayers.find((candidate) => candidate.id === targetKey && candidate.available);
        }
        if (!player) {
          sendJson(res, 400, { ok: false, error: "Player not found or unavailable." });
          return;
        }
        player.available = false;
        for (const other of s.source === "sportsline" ? s.fpPool : s.slPool) {
          if (other.id === player.id) other.available = false;
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
        sendJson(res, 200, {
          ok: true,
          pick: { overallPick, fantasyTeam: teamOnClock, playerName: player.name, position: player.position }
        });
        return;
      }

      if (req.method === "POST" && path === "/api/undo") {
        if (!room.publicStatus().writable) {
          sendJson(res, 409, { ok: false, error: ROOM_BUSY_ERROR });
          return;
        }
        const s = getSession();
        const last = s.draftedPicks.pop();
        s.draftEvents.pop();
        if (last) {
          for (const player of s.slPool) if (player.id === last.playerId) player.available = true;
          for (const player of s.fpPool) if (player.id === last.playerId) player.available = true;
        }
        sendJson(res, 200, { ok: true, undone: last ?? null });
        return;
      }

      if (req.method === "POST" && path === "/api/reset") {
        if (!room.publicStatus().writable) {
          sendJson(res, 409, { ok: false, error: ROOM_BUSY_ERROR });
          return;
        }
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
          recommendations: ranked
            .slice(0, 10)
            .map((candidate, index) => ({
              rank: index + 1,
              playerId: candidate.player.id,
              playerName: candidate.player.name,
              position: candidate.player.position,
              team: candidate.player.nflTeam ?? null,
              score: candidate.score,
              notes: candidate.notes,
              components: candidate.components
            }))
        });
        return;
      }

      sendJson(res, 404, { ok: false, error: "Not found" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attached = /already attached/i.test(message);
      sendJson(res, attached ? 409 : 500, { ok: false, error: message });
    }
  };

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      void handleRequest(req, res);
    });
    const stop = async (): Promise<void> => {
      await room.disconnect();
      await new Promise<void>((closeResolve, closeReject) => {
        server.close((error) => (error ? closeReject(error) : closeResolve()));
      });
    };
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      console.log(`Companion UI: http://localhost:${actualPort}/`);
      if (resolved.autoConnect === "fixture") {
        void room
          .connect({ source: "fixture", pauseOnUser: true, autoplay: true })
          .then(() => console.log("Companion watching the local fake draft room (read-only)."))
          .catch((error) => console.error(error instanceof Error ? error.message : error));
      } else if (resolved.autoConnect === "live") {
        void room
          .connect({ source: "live" })
          .then(() => console.log("Companion opened CBS Chrome. Open Draft Room; this UI stays read-only."))
          .catch((error) => console.error(error instanceof Error ? error.message : error));
      }
      resolve({
        port: actualPort,
        close: () => {
          void stop();
        },
        stop
      });
    });
  });
}
