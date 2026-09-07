import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { POSITIONS, type Position } from "../domain/types.js";

export const FANTASY_PROS_LOCAL_REQUEST_LIMIT = 5;
const numeric = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/).transform(Number)]).pipe(z.number().finite());
const stats = z.object({ points_ppr: numeric });
const responseSchema = z.object({
  season: numeric.pipe(z.number().int()),
  week: numeric.pipe(z.number().int()),
  count: numeric.pipe(z.number().int().nonnegative()),
  players: z.union([z.array(z.object({
    fpid: z.union([z.string().min(1), z.number()]).transform(String),
    name: z.string().min(1),
    position_id: z.enum(POSITIONS),
    team_id: z.string(),
    stats: z.union([stats, z.array(stats).length(1).transform((rows) => rows[0]!)])
  })), z.null().transform(() => []), z.object({}).strict().transform(() => [])])
});

const cacheSchema = z.object({
  source: z.literal("FantasyPros"),
  purpose: z.literal("sample-preview-only"),
  fetchedAt: z.iso.datetime(),
  season: z.number().int(),
  week: z.literal(0),
  position: z.enum(POSITIONS),
  reportedCount: z.number().int().nonnegative(),
  players: z.array(z.object({
    fantasyProsId: z.string(), name: z.string(), position: z.enum(POSITIONS),
    team: z.string(), projectedPprPoints: z.number().finite()
  }))
});

export type FantasyProsPreview = z.infer<typeof cacheSchema>;

export function parseFantasyProsProjections(raw: unknown, season: number, position: Position): FantasyProsPreview {
  const result = responseSchema.safeParse(raw);
  if (!result.success) throw new Error("FantasyPros returned an unsupported projection schema; no data imported.");
  const data = result.data;
  if (data.season !== season || data.week !== 0 || data.players.some((player) => player.position_id !== position)) {
    throw new Error("FantasyPros returned the wrong season, week, or position; no data imported.");
  }
  if (new Set(data.players.map((player) => player.fpid)).size !== data.players.length) {
    throw new Error("FantasyPros returned duplicate player IDs; no data imported.");
  }
  return {
    source: "FantasyPros", purpose: "sample-preview-only", fetchedAt: new Date().toISOString(),
    season, week: 0, position, reportedCount: data.count,
    players: data.players.map((player) => ({
      fantasyProsId: player.fpid, name: player.name, position: player.position_id,
      team: player.team_id, projectedPprPoints: player.stats.points_ppr
    }))
  };
}

function writePrivateJson(filePath: string, value: unknown): void {
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function projectionDiagnostic(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { responseType: typeof raw };
  const body = raw as Record<string, unknown>;
  const fields = ["season", "year", "week", "count", "positions", "scoring", "public_api_limited", "tier", "error", "message"];
  return {
    fields: Object.keys(body),
    ...Object.fromEntries(fields.filter((key) => key in body).map((key) => [key, body[key]])),
    players: Array.isArray(body.players) ? body.players.map((rawPlayer) => {
      if (!rawPlayer || typeof rawPlayer !== "object") return { playerType: typeof rawPlayer };
      const player = rawPlayer as Record<string, unknown>;
      const statRows = Array.isArray(player.stats) ? player.stats : [player.stats];
      const safeStats = statRows.map((row: unknown) => {
        if (!row || typeof row !== "object") return { statsType: typeof row };
        const stats = row as Record<string, unknown>;
        return {
          fields: Object.keys(stats),
          ...Object.fromEntries(["points", "points_ppr", "points_half", "stat_id", "value"]
            .filter((key) => key in stats).map((key) => [key, stats[key]]))
        };
      });
      return {
        fields: Object.keys(player),
        ...Object.fromEntries(["fpid", "name", "position_id", "team_id"]
          .filter((key) => key in player).map((key) => [key, player[key]])),
        stats: Array.isArray(player.stats) ? safeStats : safeStats[0]
      };
    }) : { responseType: body.players === null ? "null" : typeof body.players }
  };
}

export async function loadFantasyProsPreview(options: {
  season: number;
  position: Position;
  cacheDir?: string;
  refresh?: boolean;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ data: FantasyProsPreview; requestsMade: number; locallyRecordedAttempts: number }> {
  const { season, position } = options;
  if (!Number.isInteger(season) || season < 2000 || season > 2100 || !POSITIONS.includes(position)) {
    throw new Error("Invalid FantasyPros season or position; no request made.");
  }
  const cacheDir = options.cacheDir ?? ".local/fantasypros";
  const cachePath = path.join(cacheDir, `nfl-${season}-preseason-${position}.json`);
  const usagePath = path.join(cacheDir, "usage.json");
  const usageSchema = z.object({ attempts: z.number().int().nonnegative(), lastAttemptAt: z.number().nullable() });
  const readUsage = () => fs.existsSync(usagePath)
    ? usageSchema.parse(JSON.parse(fs.readFileSync(usagePath, "utf8")))
    : { attempts: 0, lastAttemptAt: null };

  if (!options.refresh) {
    if (!fs.existsSync(cachePath)) {
      throw new Error("No cached FantasyPros preview. Use --refresh explicitly to spend one API request.");
    }
    const parsed = cacheSchema.safeParse(JSON.parse(fs.readFileSync(cachePath, "utf8")));
    if (!parsed.success || parsed.data.season !== season || parsed.data.position !== position ||
        parsed.data.players.some((player) => player.position !== position)) {
      throw new Error("Invalid FantasyPros cache; no network request made.");
    }
    return { data: parsed.data, requestsMade: 0, locallyRecordedAttempts: readUsage().attempts };
  }

  if (!options.apiKey?.trim()) throw new Error("FANTASY_PROS_API is not set; no request made.");
  fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  const lockPath = path.join(cacheDir, "refresh.lock");
  let lock: number;
  try {
    lock = fs.openSync(lockPath, "wx", 0o600);
  } catch {
    throw new Error("FantasyPros refresh lock exists or cannot be created; no request made. Check for another refresh process.");
  }
  try {
    const usage = readUsage();
    if (usage.attempts >= FANTASY_PROS_LOCAL_REQUEST_LIMIT) {
      throw new Error(`FantasyPros local safety cap (${FANTASY_PROS_LOCAL_REQUEST_LIMIT} attempts) reached; no request made.`);
    }
    if (usage.lastAttemptAt !== null && Date.now() - usage.lastAttemptAt < 1000) {
      throw new Error("FantasyPros refreshes must be at least one second apart; no request made.");
    }
    usage.attempts += 1;
    usage.lastAttemptAt = Date.now();
    // Count before sending: failures and timeouts may still consume the provider's quota.
    writePrivateJson(usagePath, usage);
    const url = `https://api.fantasypros.com/public/v2/json/nfl/${season}/projections?position=${position}&week=0&ros=false`;
    let response: Response;
    let raw: unknown;
    try {
      response = await (options.fetchImpl ?? fetch)(url, {
        headers: { "x-api-key": options.apiKey, Accept: "application/json" },
        redirect: "error", signal: AbortSignal.timeout(15000)
      });
      if (response.ok) raw = await response.json();
      else await response.body?.cancel();
    } catch {
      throw new Error("FantasyPros request failed or returned invalid JSON; one attempt recorded, no retry made.");
    }
    if (!response.ok) throw new Error(`FantasyPros HTTP ${response.status}; one attempt recorded, no retry made.`);
    let data: FantasyProsPreview;
    try {
      data = parseFantasyProsProjections(raw, season, position);
    } catch (error) {
      const diagnostic = JSON.parse(JSON.stringify(projectionDiagnostic(raw)).split(options.apiKey).join("<REDACTED>"));
      writePrivateJson(path.join(cacheDir, `nfl-${season}-preseason-${position}-diagnostic.json`), diagnostic);
      throw error;
    }
    writePrivateJson(cachePath, data);
    return { data, requestsMade: 1, locallyRecordedAttempts: usage.attempts };
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(lockPath);
  }
}
