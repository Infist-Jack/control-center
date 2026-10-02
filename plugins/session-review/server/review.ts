import type { Decision, Progress, ReviewResult, Scope, SessionCard, SessionDetail } from "../shared/model.ts";
import { EXCERPT_MAX, MESSAGE_MAX, SESSION_LIMIT, TITLE_MAX } from "../shared/model.ts";
import { attribute, inScope, loadCatalog, type Catalog } from "./catalog.ts";
import { clip } from "./decisions.ts";
import type { Homes } from "./paths.ts";
import { isUnder } from "./paths.ts";
import { redactDeep } from "./redact.ts";
import { parseClaude, scanClaude } from "./sources/claude.ts";
import { parseCodex, scanCodex } from "./sources/codex.ts";
import type { Candidate, ExtractedSession } from "./sources/types.ts";
import { peakParallel, spansFromTurns, sumMs, unionRunMs } from "./spans.ts";
import type { Store } from "./store.ts";

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfDay(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}
function endOfDay(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

export function resolveRange(range: Scope["range"], now = new Date()): { from: Date; to: Date; fromKey: string; toKey: string } {
  const today = localDateKey(now);
  let fromKey = today, toKey = today;
  if (range.kind === "yesterday") {
    const y = new Date(now); y.setDate(y.getDate() - 1); fromKey = toKey = localDateKey(y);
  } else if (range.kind === "last7") {
    const s = new Date(now); s.setDate(s.getDate() - 6); fromKey = localDateKey(s);
  } else if (range.kind === "custom") {
    fromKey = range.from ?? today; toKey = range.to ?? fromKey;
    if (fromKey > toKey) [fromKey, toKey] = [toKey, fromKey];
  }
  return { from: startOfDay(fromKey), to: endOfDay(toKey), fromKey, toKey };
}

export function scopeKey(scope: Scope, resolved: { fromKey: string; toKey: string }): string {
  return JSON.stringify([scope.projectId ?? null, resolved.fromKey, resolved.toKey, scope.branch ?? null]);
}

/** Parse or reuse the cached extraction for one candidate. Never throws; parse failures become `error`. */
export async function extractOne(candidate: Candidate, store: Store): Promise<ExtractedSession> {
  const cached = await store.readExtract(candidate.provider, candidate.id, candidate.mtimeMs, candidate.size);
  if (cached) return cached;
  try {
    const parsed = candidate.provider === "claude" ? await parseClaude(candidate) : await parseCodex(candidate);
    const redacted = redactDeep(parsed);
    await store.writeExtract(redacted, candidate.mtimeMs, candidate.size);
    return redacted;
  } catch (error) {
    return {
      id: candidate.id, provider: candidate.provider, file: candidate.file, cwd: candidate.cwd, branch: null,
      startedAt: candidate.startedAt, endedAt: candidate.startedAt, title: "（无法解析）", messages: [], turns: [], decisions: [],
      userMessages: 0, forkedFrom: candidate.forkedFrom, hiddenThreads: [], error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface ReviewDeps { homes: Homes; store: Store; now?: () => Date }

export async function runReview(scope: Scope, deps: ReviewDeps, report: (p: Progress) => void, signal?: AbortSignal): Promise<ReviewResult> {
  const now = deps.now ? deps.now() : new Date();
  const resolved = resolveRange(scope.range, now);
  report({ phase: "读取 Paseo 目录", done: 0, total: 0 });
  const catalog = await loadCatalog(deps.homes.paseoHome);

  report({ phase: "扫描会话文件", done: 0, total: 0 });
  const [claude, codex] = await Promise.all([
    scanClaude(deps.homes.claudeHome, resolved.from, resolved.to),
    scanCodex(deps.homes.codexHome, resolved.from, resolved.to),
  ]);
  const all = [...claude, ...codex].filter((c) => !isUnder(c.cwd, deps.homes.dataDir));

  // Fold Codex child threads into their parents before anything else.
  const hiddenByParent = new Map<string, string[]>();
  const candidates: Candidate[] = [];
  for (const c of all) {
    if (c.hiddenChildOf) { hiddenByParent.set(c.hiddenChildOf, [...(hiddenByParent.get(c.hiddenChildOf) ?? []), c.id]); continue; }
    candidates.push(c);
  }

  // Attribution happens before parsing so out-of-scope files are never read in full.
  const selected = candidates.filter((c) => inScope(attribute(catalog, c.id, c.cwd), scope));
  if (selected.length > SESSION_LIMIT) throw new Error(`范围内有 ${selected.length} 个会话，超过 ${SESSION_LIMIT} 个，请收窄日期范围或工作区`);

  const sessions: ExtractedSession[] = [];
  for (const [index, candidate] of selected.entries()) {
    if (signal?.aborted) throw new Error("任务已中断");
    report({ phase: "解析会话", done: index, total: selected.length });
    sessions.push(await extractOne(candidate, deps.store));
  }
  report({ phase: "整理", done: selected.length, total: selected.length });

  // A resumed Claude session is written to a new file that starts with a copy of the old one;
  // keep the longest copy and count the others as folded threads.
  const deduped = foldResumedCopies(sessions, hiddenByParent);
  const filtered = scope.branch ? deduped.filter((s) => s.branch === scope.branch) : deduped;
  const cards = toCards(filtered, catalog, hiddenByParent);
  const spans = cards.map((c) => c.spans);
  return {
    scope, from: resolved.fromKey, to: resolved.toKey,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    generatedAt: new Date().toISOString(),
    overview: {
      sessions: cards.length,
      peakParallel: peakParallel(spans),
      activeMs: unionRunMs(spans),
      waitMs: cards.reduce((acc, c) => acc + c.waitMs, 0),
      decisions: cards.reduce((acc, c) => acc + c.decisions.length, 0),
      unparsable: cards.filter((c) => c.error).length,
    },
    sessions: cards,
  };
}

export function foldResumedCopies(sessions: ExtractedSession[], hiddenByParent: Map<string, string[]>): ExtractedSession[] {
  // Only Claude Code copies history into a new file on resume; Codex forks are explicit (`forkedFrom`) and stay separate.
  const groups = new Map<string, ExtractedSession[]>();
  for (const s of sessions) {
    const firstUser = s.messages.find((m) => m.role === "user");
    const foldable = s.provider === "claude" && !s.forkedFrom && firstUser;
    const key = foldable ? `${s.provider}|${s.cwd}|${firstUser.at}|${firstUser.text.slice(0, 200)}` : `${s.provider}|${s.id}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const out: ExtractedSession[] = [];
  for (const group of groups.values()) {
    const [keep, ...rest] = [...group].sort((a, b) => b.messages.length - a.messages.length || b.endedAt.localeCompare(a.endedAt));
    if (rest.length) hiddenByParent.set(keep.id, [...(hiddenByParent.get(keep.id) ?? []), ...rest.map((r) => r.id)]);
    out.push(keep);
  }
  return out;
}

export function toCards(sessions: ExtractedSession[], catalog: Catalog, hiddenByParent: Map<string, string[]>): SessionCard[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const cards = new Map<string, SessionCard>();
  for (const s of sessions) {
    const a = attribute(catalog, s.id, s.cwd);
    const spans = spansFromTurns(s.turns);
    cards.set(s.id, {
      id: s.id, provider: s.provider, title: clip(s.title, TITLE_MAX) || "（无标题）", startedAt: s.startedAt, endedAt: s.endedAt,
      activeMs: sumMs(spans, "run"), waitMs: sumMs(spans, "wait"), userMessages: s.userMessages,
      agentId: a.agentId, projectId: a.projectId,
      branch: s.branch, cwd: s.cwd, forkedFrom: s.forkedFrom, depth: 0,
      hiddenThreads: (hiddenByParent.get(s.id) ?? []).length,
      spans, decisions: s.decisions.map(shortenDecision), error: s.error, file: s.file,
    });
  }
  // Order: by start time; a fork whose parent is in scope sits right under the parent with depth 1.
  const roots = [...cards.values()].filter((c) => !(c.forkedFrom && byId.has(c.forkedFrom))).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const ordered: SessionCard[] = [];
  for (const root of roots) {
    ordered.push(root);
    const children = [...cards.values()].filter((c) => c.forkedFrom === root.id).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    for (const child of children) ordered.push({ ...child, depth: 1 });
  }
  return ordered;
}

function shortenDecision(d: Decision): Decision {
  return { ...d, excerpt: clip(d.excerpt, EXCERPT_MAX), answer: d.answer ? clip(d.answer, 200) : d.answer, next: d.next ? clip(d.next, 60) : d.next };
}

export async function sessionDetail(provider: "claude" | "codex", id: string, store: Store): Promise<SessionDetail> {
  const session = await store.readExtractAny(provider, id);
  if (!session) throw new Error("没有这个会话的抽取结果，请先重新运行复盘");
  return {
    id: session.id, provider: session.provider, title: clip(session.title, TITLE_MAX), cwd: session.cwd, file: session.file,
    messages: session.messages.map((m) => ({ ...m, text: m.text.length > MESSAGE_MAX ? `${m.text.slice(0, MESSAGE_MAX)}…` : m.text })),
    decisions: session.decisions.map(shortenDecision),
  };
}
