import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { DraftDecisionModelSchema } from "../config/schema.js";
import type { CandidateScore, DraftDecision, DraftState, LeagueConfig, StrategyConfig } from "../domain/types.js";
import { deterministicDecision } from "../engine/decision.js";
import { buildDecisionPayload, buildSystemPrompt } from "./prompt.js";
import { validateModelDecision } from "./validate.js";

export interface AIOptions {
  model: string;
  reasoningEffort: "none" | "minimal" | "low" | "medium" | "high";
  timeoutMs: number;
  confidenceThreshold: number;
  apiKey?: string | null;
  decisionModel?: DecisionModel;
}

export interface DecisionModelRequest {
  model: string;
  reasoningEffort: AIOptions["reasoningEffort"];
  systemPrompt: string;
  userPayload: Record<string, unknown>;
  timeoutMs: number;
  abortSignal: AbortSignal;
}

export interface DecisionModel {
  parse(request: DecisionModelRequest): Promise<unknown>;
}

export function createOpenAIDecisionModel(apiKey: string): DecisionModel {
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL ?? undefined
  });
  return {
    async parse(request) {
      const response = await client.responses.parse(
        {
          model: request.model,
          reasoning: { effort: request.reasoningEffort },
          input: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: JSON.stringify(request.userPayload) }
          ],
          text: {
            format: zodTextFormat(DraftDecisionModelSchema, "draft_decision")
          }
        },
        { timeout: request.timeoutMs, signal: request.abortSignal }
      );
      return response.output_parsed;
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

  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? null;
  const model = options.decisionModel ?? (apiKey ? createOpenAIDecisionModel(apiKey) : null);
  if (!model) {
    return withLatency(fallback, "OPENAI_API_KEY missing");
  }

  const payload = buildDecisionPayload(candidates, state, league, strategy);
  const allowedIds = candidates.map((candidate) => candidate.player.id);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const parsed = await Promise.race([
      model.parse({
        model: options.model,
        reasoningEffort: options.reasoningEffort,
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

    const validated = validateModelDecision(parsed, allowedIds, options.confidenceThreshold);
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
    model: process.env.OPENAI_MODEL ?? "gpt-5.6",
    reasoningEffort:
      (process.env.OPENAI_REASONING_EFFORT as AIOptions["reasoningEffort"] | undefined) ?? "low",
    timeoutMs: strategy.aiTimeoutMs,
    confidenceThreshold: strategy.aiConfidenceThreshold
  };
}
