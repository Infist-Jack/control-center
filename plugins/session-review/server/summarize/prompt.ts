import type { Message, ReviewResult, SessionCard } from "../../shared/model.ts";
import { firstSentence, lastSentence } from "../decisions.ts";
import type { ExtractedSession } from "../sources/types.ts";

export const INPUT_BUDGET = 60_000;

const SYSTEM = [
  "你是一个只读的复盘助手。你将收到一天（或一段范围）里多个 coding agent 会话的结构化摘要：每个会话的标题、起止、用户消息、每轮 agent 回复的首末句、以及确定性的决策点（agent 提问、用户打断或拒绝、写入记忆）。",
  "只依据输入作答，不编造输入里没有的事实；不知道就写“输入不足”。用中文。",
  "输出必须是符合给定 JSON Schema 的单个 JSON 对象，不要任何额外文字。",
  "字段约定：sessions[].outcome 取 delivered（交付了可用结果）、abandoned（主动放弃）、overturned（被后来的决定推翻）、unfinished（没有结束）；ifAgain 写一句“如果重来会怎么做”。",
  "day.buckets 用“环境、理解、建设、部署、沟通、其他”六个名称估算分钟数；day.longestWaits 取等待最久的三处；day.oneLine 一句话总结。",
].join("\n");

export interface SummaryInputSession {
  id: string; provider: string; title: string; startedAt: string; endedAt: string; activeMinutes: number; waitMinutes: number;
  userMessages: string[]; turns: Array<{ first: string; last: string }>; decisions: Array<{ at: string; kind: string; excerpt: string; answer: string | null; next: string | null }>;
  unmanaged: boolean; forkedFrom: string | null;
}

export function sessionInput(card: SessionCard, extracted: ExtractedSession | null): SummaryInputSession {
  const messages: Message[] = extracted?.messages ?? [];
  const turns: Array<{ first: string; last: string }> = [];
  let current: string[] = [];
  for (const m of messages) {
    if (m.role === "user") { if (current.length) turns.push(fold(current)); current = []; }
    else if (m.role === "assistant") current.push(m.text);
  }
  if (current.length) turns.push(fold(current));
  return {
    id: card.id, provider: card.provider, title: card.title, startedAt: card.startedAt, endedAt: card.endedAt,
    activeMinutes: Math.round(card.activeMs / 60_000), waitMinutes: Math.round(card.waitMs / 60_000),
    userMessages: messages.filter((m) => m.role === "user").map((m) => m.text.length > 300 ? `${m.text.slice(0, 300)}…` : m.text),
    turns,
    decisions: card.decisions.map((d) => ({ at: d.at, kind: d.kind, excerpt: d.excerpt, answer: d.answer, next: d.next })),
    unmanaged: card.unmanaged, forkedFrom: card.forkedFrom,
  };
}

function fold(texts: string[]): { first: string; last: string } {
  return { first: firstSentence(texts[0], 120), last: lastSentence(texts[texts.length - 1], 120) };
}

export function dayInput(result: ReviewResult) {
  return {
    from: result.from, to: result.to, timezone: result.timezone,
    sessions: result.overview.sessions, peakParallel: result.overview.peakParallel,
    activeMinutes: Math.round(result.overview.activeMs / 60_000), waitMinutes: Math.round(result.overview.waitMs / 60_000),
  };
}

export function buildPrompt(presetBody: string, input: unknown, task: "full" | "sessions" | "day"): string {
  const taskLine = task === "sessions" ? "本次只输出 sessions 字段。" : task === "day" ? "输入是各会话已经归纳好的结果，本次只输出 day 字段。" : "";
  return [SYSTEM, "", "用户指定的归纳注重点：", presetBody.trim(), taskLine, "", "输入：", JSON.stringify(input, null, 1)].join("\n");
}
