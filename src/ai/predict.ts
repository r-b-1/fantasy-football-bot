import { z } from "zod";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type {
  DraftState,
  LeagueConfig,
  LivePlayer,
  NextPicksProjection,
  ProjectedPick,
  StrategyConfig
} from "../domain/types.js";
import { deterministicProjection, projectionHorizonFromStrategy } from "../engine/predict.js";

export const ProjectionModelSchema = z.object({
  picks: z
    .array(
      z.object({
        playerId: z.string().min(1),
        playerName: z.string().min(1),
        expectedOverallPick: z.number().int().positive(),
        confidence: z.number().min(0).max(1)
      })
    )
    .min(1)
    .max(20),
  rationale: z.string().max(400)
});

export type ProjectionModelOutput = z.infer<typeof ProjectionModelSchema>;

export interface ProjectionAIOptions {
  model: string;
  timeoutMs: number;
  apiKey?: string | null;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
}

export interface ProjectionModel {
  parse(request: {
    model: string;
    systemPrompt: string;
    userPayload: Record<string, unknown>;
    timeoutMs: number;
    abortSignal: AbortSignal;
    reasoningEffort?: ProjectionAIOptions["reasoningEffort"];
  }): Promise<unknown>;
}

export function createOpenAIProjectionModel(apiKey: string): ProjectionModel {
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL ?? undefined
  });
  return {
    async parse(request) {
      const response = await client.responses.parse(
        {
          model: request.model,
          reasoning: request.reasoningEffort ? { effort: request.reasoningEffort } : undefined,
          input: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: JSON.stringify(request.userPayload) }
          ],
          text: { format: zodTextFormat(ProjectionModelSchema, "next_picks_projection") }
        },
        { timeout: request.timeoutMs, signal: request.abortSignal }
      );
      return response.output_parsed;
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
  model?: ProjectionModel;
  horizon?: number;
  timeoutMs?: number;
  reasoningEffort?: ProjectionAIOptions["reasoningEffort"];
  aiModelName?: string;
}

const SYSTEM_PROMPT =
  "You are a bounded fantasy-football projection layer. Given the current draft state, recent picks, roster composition, and the list of remaining players, predict the next several picks in order. Each projected pick must reference an id and name from the supplied remainingPlayers list — never invent a player. Return concise structured output only.";

export async function predictNextPicks(args: PredictArgs): Promise<ProjectionResult> {
  const horizon = args.horizon ?? projectionHorizonFromStrategy(args.strategy);
  const fallback = deterministicProjection(args.players, args.state, args.league, args.strategy, {
    horizon
  });
  const started = Date.now();
  const withMeta = (projection: NextPicksProjection, source: ProjectionResult["source"], reason?: string): ProjectionResult => ({
    ...projection,
    source,
    fallbackReason: reason,
    latencyMs: Date.now() - started
  });

  const wantAI = args.useAI !== false;
  const apiKey = args.apiKey ?? process.env.OPENAI_API_KEY ?? null;
  const model = args.model ?? (wantAI && apiKey ? createOpenAIProjectionModel(apiKey) : null);

  if (!model) {
    return withMeta(fallback, "deterministic", wantAI ? "OPENAI_API_KEY missing" : "AI disabled");
  }

  const payload = buildProjectionPayload(args.players, args.state, args.league, horizon);
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
        model: args.aiModelName ?? process.env.OPENAI_MODEL ?? "gpt-5.6",
        reasoningEffort: args.reasoningEffort ?? "low",
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

    const validation = validateProjection(parsed, allowedIds, horizon);
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
  horizon: number
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

  return {
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
  const picks: ProjectedPick[] = [];
  const seen = new Set<string>();
  for (const pick of result.data.picks.slice(0, horizon)) {
    if (!allowedIds.has(pick.playerId)) {
      return { ok: false, reason: `projected player ${pick.playerId} is not in the available pool` };
    }
    if (seen.has(pick.playerId)) {
      return { ok: false, reason: `duplicate projected player ${pick.playerId}` };
    }
    seen.add(pick.playerId);
    const playerName = pick.playerName;
    picks.push({
      playerId: pick.playerId,
      playerName,
      position: "RB",
      expectedOverallPick: pick.expectedOverallPick,
      confidence: pick.confidence,
      source: "ai"
    });
  }
  if (picks.length === 0) {
    return { ok: false, reason: "no projected picks returned" };
  }
  return { ok: true, picks, rationale: result.data.rationale };
}