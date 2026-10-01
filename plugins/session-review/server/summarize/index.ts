import type { Progress, RuntimeId, Scope, Summary } from "../../shared/model.ts";
import { summarySchema } from "../../shared/model.ts";
import { resolveRange, runReview, scopeKey, type ReviewDeps } from "../review.ts";
import { hashKey } from "../store.ts";
import { INPUT_BUDGET, buildPrompt, dayInput, sessionInput } from "./prompt.ts";
import { runRuntime } from "./runtimes.ts";
import { dayOnlySchema, jsonSchemaOf, sessionsOnlySchema } from "./schema.ts";

export interface SummaryRequest { scope: Scope; runtime: RuntimeId; presetId: string }
export interface SummaryOutcome { summary: Summary; cached: boolean; stderrTail: string; key: string }

export async function summaryCacheKey(request: SummaryRequest, deps: ReviewDeps): Promise<{ key: string; presetBody: string; review: Awaited<ReturnType<typeof runReview>> }> {
  const preset = await deps.store.getPreset(request.presetId);
  if (!preset) throw new Error("预设不存在");
  const review = await runReview(request.scope, deps, () => {});
  const key = hashKey([
    scopeKey(request.scope, resolveRange(request.scope.range, deps.now ? deps.now() : new Date())),
    review.sessions.map((s) => [s.id, s.endedAt, s.userMessages, s.decisions.length]),
    request.runtime, preset.body,
  ]);
  return { key, presetBody: preset.body, review };
}

export async function runSummary(request: SummaryRequest, deps: ReviewDeps, report: (p: Progress) => void, signal?: AbortSignal): Promise<SummaryOutcome> {
  report({ phase: "准备输入", done: 0, total: 0 });
  const { key, presetBody, review } = await summaryCacheKey(request, deps);
  const cached = await deps.store.readSummary(key);
  if (cached) return { summary: cached.summary, cached: true, stderrTail: "", key };
  if (review.sessions.length === 0) throw new Error("范围内没有会话，没什么可归纳的");

  const sessions = [];
  for (const card of review.sessions) {
    sessions.push(sessionInput(card, await deps.store.readExtractAny(card.provider, card.id)));
  }
  const fullInput = { day: dayInput(review), sessions };
  const fullPrompt = buildPrompt(presetBody, fullInput, "full");
  let stderrTail = "";
  let summary: Summary;

  if (fullPrompt.length <= INPUT_BUDGET) {
    report({ phase: `调用 ${request.runtime}`, done: 0, total: 1 });
    const result = await runRuntime(request.runtime, fullPrompt, jsonSchemaOf(summarySchema), deps.store.scratchDir, signal);
    stderrTail = result.stderrTail;
    summary = summarySchema.parse(result.json);
  } else {
    // Two stages: one call per session, then one call for the day from the session results.
    const perSession: Summary["sessions"] = [];
    for (const [index, s] of sessions.entries()) {
      if (signal?.aborted) throw new Error("任务已中断");
      report({ phase: `逐会话归纳 ${request.runtime}`, done: index, total: sessions.length + 1 });
      const result = await runRuntime(request.runtime, buildPrompt(presetBody, { day: fullInput.day, sessions: [s] }, "sessions"), jsonSchemaOf(sessionsOnlySchema), deps.store.scratchDir, signal);
      stderrTail = result.stderrTail;
      perSession.push(...sessionsOnlySchema.parse(result.json).sessions);
    }
    report({ phase: `日级归纳 ${request.runtime}`, done: sessions.length, total: sessions.length + 1 });
    const dayResult = await runRuntime(request.runtime, buildPrompt(presetBody, { day: fullInput.day, sessions: perSession, waits: sessions.map((s) => ({ id: s.id, waitMinutes: s.waitMinutes })) }, "day"), jsonSchemaOf(dayOnlySchema), deps.store.scratchDir, signal);
    stderrTail = dayResult.stderrTail;
    summary = summarySchema.parse({ sessions: perSession, day: dayOnlySchema.parse(dayResult.json).day });
  }
  await deps.store.writeSummary(key, summary);
  return { summary, cached: false, stderrTail, key };
}
