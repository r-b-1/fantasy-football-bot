import type { CandidateScore, DraftDecision, DraftState, LeagueConfig, StrategyConfig } from "../domain/types.js";
import { deterministicDecision } from "../engine/decision.js";
import { buildDecisionPayload, buildSystemPrompt } from "./prompt.js";
import { stripMarkdownFences } from "./parse.js";
import { validateModelDecision } from "./validate.js";

export const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export interface AIOptions {
  model: string;
  timeoutMs: number;
  confidenceThreshold: number;
  apiKey?: string | null;
  baseURL?: string | null;
  decisionModel?: DecisionModel;
}

export interface DecisionModelRequest {
  model: string;
  systemPrompt: string;
  userPayload: Record<string, unknown>;
  timeoutMs: number;
  abortSignal: AbortSignal;
}

export interface DecisionModel {
  parse(request: DecisionModelRequest): Promise<unknown>;
}

function resolveBaseURL(): string {
  return process.env.OPENROUTER_BASE_URL ?? OPENROUTER_DEFAULT_BASE_URL;
}

export function createOpenRouterDecisionModel(apiKey: string, baseURL?: string | null): DecisionModel {
  const url = (baseURL ?? resolveBaseURL()).replace(/\/$/, "");
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

export async function chooseWithAI(
  candidates: CandidateScore[],
  state: DraftState,
  league: LeagueConfig,
  strategy: StrategyConfig,
  options: AIOptions
): Promise<DraftDecision> {
  const fallback = deterministicDecision(candidates);
  const started = Date.now();
  const withLatency = (decision: DraftDecision, reason?: string): DraftDecision => ({
    ...decision,
    latencyMs: Date.now() - started,
    fallbackReason: reason
  });

  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY ?? null;
  const model =
    options.decisionModel ?? (apiKey ? createOpenRouterDecisionModel(apiKey, options.baseURL) : null);
  if (!model) {
    return withLatency(fallback, "OPENROUTER_API_KEY missing");
  }

  const payload = buildDecisionPayload(candidates, state, league, strategy);
  const allowedIds = candidates.map((candidate) => candidate.player.id);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const parsed = await Promise.race([
      model.parse({
        model: options.model,
        systemPrompt: buildSystemPrompt(league, strategy),
        userPayload: payload,
        timeoutMs: options.timeoutMs,
        abortSignal: controller.signal
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`AI timeout after ${options.timeoutMs}ms`));
        }, options.timeoutMs);
      })
    ]);

    const validated = validateModelDecision(
      stripMarkdownFences(parsed),
      allowedIds,
      options.confidenceThreshold
    );
    if (!validated.ok) return withLatency(fallback, validated.reason);
    return {
      ...validated.decision,
      source: "ai",
      latencyMs: Date.now() - started
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "AI request failed";
    return withLatency(fallback, reason);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function defaultAIOptions(strategy: StrategyConfig): AIOptions {
  return {
    model: process.env.OPENROUTER_MODEL ?? "minimax/minimax-m3:free",
    timeoutMs: strategy.aiTimeoutMs,
    confidenceThreshold: strategy.aiConfidenceThreshold
  };
}