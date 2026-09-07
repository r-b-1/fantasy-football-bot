import { z } from "zod";
import { POSITIONS, type DraftState, type LeagueConfig, type LivePlayer, type NextPicksProjection, type Position, type ProjectedPick, type StrategyConfig } from "../domain/types.js";
import { deterministicProjection, projectionHorizonFromStrategy } from "../engine/predict.js";
import type { RosterGrid } from "../data/rosterGrid.js";
import { computeTeamNeeds, weightedNextPickByTeam } from "../engine/teamNeed.js";
import { OPENROUTER_DEFAULT_BASE_URL } from "./openrouter.js";
import { stripMarkdownFences } from "./parse.js";

export const ProjectionModelSchema = z.object({
  picks: z
    .array(
      z
        .object({
          playerId: z.string().min(1),
          playerName: z.string().min(1),
          position: z.enum(POSITIONS),
          expectedOverallPick: z.number().int().positive(),
          confidence: z.number().min(0).max(1)
        })
        .passthrough()
    )
    .min(1)
    .max(20)
    .optional(),
  projectedPicks: z
    .array(
      z
        .object({
          playerId: z.string().min(1),
          playerName: z.string().min(1),
          position: z.enum(POSITIONS),
          expectedOverallPick: z.number().int().positive(),
          confidence: z.number().min(0).max(1).optional()
        })
        .passthrough()
    )
    .min(1)
    .max(20)
    .optional(),
  rationale: z.string().max(400).optional()
});

export interface ProjectionAIOptions {
  model: string;
  timeoutMs: number;
  apiKey?: string | null;
  baseURL?: string | null;
}

export interface ProjectionModel {
  parse(request: {
    model: string;
    systemPrompt: string;
    userPayload: Record<string, unknown>;
    timeoutMs: number;
    abortSignal: AbortSignal;
  }): Promise<unknown>;
}

export function createOpenRouterProjectionModel(
  apiKey: string,
  baseURL?: string | null
): ProjectionModel {
  const url = (baseURL ?? process.env.OPENROUTER_BASE_URL ?? OPENROUTER_DEFAULT_BASE_URL).replace(
    /\/$/,
    ""
  );
  return {
    async parse(request) {
      const res = await fetch(`${url}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: request.model,
          messages: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: JSON.stringify(request.userPayload) }
          ]
        }),
        signal: request.abortSignal
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`OpenRouter HTTP ${res.status}: ${body.slice(0, 300)}`);
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      const content = json.choices?.[0]?.message?.content ?? null;
      if (process.env.AI_DEBUG) {
        console.log("RAW_AI:", typeof content === "string" ? content.slice(0, 800) : content);
      }
      return content;
    }
  };
}

export interface ProjectionResult extends NextPicksProjection {
  source: "ai" | "deterministic";
  fallbackReason?: string;
  latencyMs: number;
}

export interface PredictArgs {
  players: LivePlayer[];
  state: DraftState;
  league: LeagueConfig;
  strategy: StrategyConfig;
  useAI?: boolean;
  apiKey?: string | null;
  baseURL?: string | null;
  model?: ProjectionModel;
  horizon?: number;
  timeoutMs?: number;
  aiModelName?: string;
  rosterGrid?: RosterGrid;
}

const SYSTEM_PROMPT = [
  "You are a bounded fantasy-football projection layer. Given the current draft state, recent picks, roster composition, and the list of remaining players, predict the next several picks in order. Each projected pick must reference an id and name from the supplied remainingPlayers list — never invent a player.",
  "",
  "OUTPUT FORMAT — STRICT:",
  "Reply with a single JSON object and nothing else. No markdown. No code fences. No prose.",
  "The first character of your reply must be '{' and the last character must be '}'.",
  "Do not wrap the JSON in any commentary before or after it.",
  "",
  "Required fields in the JSON:",
  "  picks (array of objects)",
  "  Each pick object must include: playerId (string), playerName (string), position (one of QB/RB/WR/TE/K/DST), expectedOverallPick (integer), confidence (number 0-1).",
  "  You may include additional fields like 'team' or 'overallPick' — they will be ignored.",
  "",
  "Example minimal valid response:",
  "{\"picks\":[{\"playerId\":\"puka nacua::WR\",\"playerName\":\"Puka Nacua\",\"position\":\"WR\",\"expectedOverallPick\":22,\"confidence\":0.81}]}"
].join("\n");

export async function predictNextPicks(args: PredictArgs): Promise<ProjectionResult> {
  const horizon = args.horizon ?? projectionHorizonFromStrategy(args.strategy);
  const fallback = deterministicProjection(args.players, args.state, args.league, args.strategy, {
    horizon,
    rosterGrid: args.rosterGrid
  });
  const started = Date.now();
  const withMeta = (projection: NextPicksProjection, source: ProjectionResult["source"], reason?: string): ProjectionResult => ({
    ...projection,
    source,
    fallbackReason: reason,
    latencyMs: Date.now() - started
  });

  const wantAI = args.useAI !== false;
  const apiKey = args.apiKey ?? process.env.OPENROUTER_API_KEY ?? null;
  const model =
    args.model ??
    (wantAI && apiKey ? createOpenRouterProjectionModel(apiKey, args.baseURL) : null);

  if (!model) {
    return withMeta(fallback, "deterministic", wantAI ? "OPENROUTER_API_KEY missing" : "AI disabled");
  }

  const payload = buildProjectionPayload(args.players, args.state, args.league, horizon, args.rosterGrid);
  const allowedIds = new Set(
    args.players
      .filter((player) => player.available && args.state.availablePlayerIds.has(player.id))
      .map((player) => player.id)
  );

  const controller = new AbortController();
  const timeoutMs = args.timeoutMs ?? args.strategy.aiTimeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const parsed = await Promise.race([
      model.parse({
        model: args.aiModelName ?? process.env.OPENROUTER_MODEL ?? "minimax/minimax-m3:free",
        systemPrompt: SYSTEM_PROMPT,
        userPayload: payload,
        timeoutMs,
        abortSignal: controller.signal
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`AI timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);

    const validation = validateProjection(stripMarkdownFences(parsed), allowedIds, horizon);
    if (!validation.ok) return withMeta(fallback, "deterministic", validation.reason);
    return withMeta(
      {
        generatedAt: new Date().toISOString(),
        currentOverallPick: args.state.currentOverallPick,
        horizon,
        projectedPicks: validation.picks,
        notes: [validation.rationale]
      },
      "ai"
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "AI projection failed";
    return withMeta(fallback, "deterministic", reason);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildProjectionPayload(
  players: LivePlayer[],
  state: DraftState,
  league: LeagueConfig,
  horizon: number,
  rosterGrid?: RosterGrid
): Record<string, unknown> {
  const available = players
    .filter((player) => player.available && state.availablePlayerIds.has(player.id))
    .map((player) => ({
      id: player.id,
      name: player.name,
      position: player.position,
      adp: player.adp,
      sportslineRating: player.sportslineRating,
      byeWeek: player.byeWeek
    }));

  const recent = state.draftEvents.slice(-12).map((event) => ({
    overallPick: event.overallPick,
    team: event.fantasyTeam,
    playerName: event.playerName,
    position: event.position ?? null
  }));

  const rosterByPosition: Record<string, string[]> = {};
  for (const player of state.roster.players) {
    const position = player.position;
    if (!rosterByPosition[position]) rosterByPosition[position] = [];
    rosterByPosition[position].push(player.name);
  }

  const payload: Record<string, unknown> = {
    currentOverallPick: state.currentOverallPick,
    nextUserPick: state.nextUserOverallPick,
    teamOnClock: state.teamOnClock,
    horizon,
    recentPicks: recent,
    rosterByPosition,
    remainingPlayerCount: available.length,
    remainingPlayers: available,
    lineup: league.lineup,
    teamCount: league.teamCount,
    scoringFormat: league.scoringFormat
  };

  if (rosterGrid) {
    const nextPicksByTeam = weightedNextPickByTeam({
      league,
      currentOverallPick: state.currentOverallPick,
      userTeamName: league.userTeamName,
      knownUserOverallPicks: league.knownOverallPicks
    });
    const teamNeeds = computeTeamNeeds({
      rosterGrid,
      drafted: state.draftEvents.map((event) => ({
        fantasyTeam: event.fantasyTeam,
        playerName: event.playerName,
        position: event.position
      })),
      nextPicksByTeam,
      league
    });
    payload.teamNeeds = teamNeeds.map((need) => ({
      teamName: need.teamName,
      nextOverallPick: need.nextOverallPick,
      startingNeed: need.startingNeed,
      totalGap: need.totalGap
    }));
    payload.teamNeedGuidance =
      "For each upcoming non-user pick, prefer a player whose position fills a team's startingNeed gap. Team with the smallest gap is most likely to take a non-need pick (BPA).";
  }

  return payload;
}

interface ProjectionValidationOk {
  ok: true;
  picks: ProjectedPick[];
  rationale: string;
}

interface ProjectionValidationFail {
  ok: false;
  reason: string;
}

function validateProjection(
  parsed: unknown,
  allowedIds: Set<string>,
  horizon: number
): ProjectionValidationOk | ProjectionValidationFail {
  const result = ProjectionModelSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, reason: `invalid structured output: ${result.error.message}` };
  }
  const rawPicks = result.data.picks ?? result.data.projectedPicks ?? [];
  const picks: ProjectedPick[] = [];
  const seen = new Set<string>();
  for (const pick of rawPicks.slice(0, horizon)) {
    if (!allowedIds.has(pick.playerId)) {
      return { ok: false, reason: `projected player ${pick.playerId} is not in the available pool` };
    }
    if (seen.has(pick.playerId)) {
      return { ok: false, reason: `duplicate projected player ${pick.playerId}` };
    }
    seen.add(pick.playerId);
    const playerName = pick.playerName;
    const position = pick.position as Position;
    picks.push({
      playerId: pick.playerId,
      playerName,
      position,
      expectedOverallPick: pick.expectedOverallPick,
      confidence: pick.confidence ?? 0.5,
      source: "ai"
    });
  }
  if (picks.length === 0) {
    return { ok: false, reason: "no projected picks returned" };
  }
  return { ok: true, picks, rationale: result.data.rationale ?? "" };
}