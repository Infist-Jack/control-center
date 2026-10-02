import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Decision, Message } from "../../shared/model.ts";
import { TITLE_MAX } from "../../shared/model.ts";
import {
  CLAUDE_DENIED_PREFIX, CLAUDE_INTERRUPT_PREFIX, CLAUDE_MEMORY_PATH, CLAUDE_QUESTION_TOOL, CLAUDE_WRITE_TOOLS,
  attachNext, clip, lastSentence, memoryExcerpt, memoryKind, parseClaudeAnswers, toolTarget,
} from "../decisions.ts";
import type { Turn } from "../spans.ts";
import { peekJsonLines, readJsonLines, textBlocks } from "./jsonl.ts";
import type { Candidate, ExtractedSession } from "./types.ts";

// Text the CLI injects as "user" content that no human typed.
const INJECTED_PREFIXES = ["<system-reminder>", "<command-name>", "<local-command", "Base directory for this skill:", "<bash-input>", "<bash-stdout>", "<bash-stderr>"];
const SYSTEM_PREFIXES = ["<task-notification>"];

function startsWithAny(text: string, prefixes: string[]): boolean {
  const trimmed = text.trimStart();
  return prefixes.some((p) => trimmed.startsWith(p));
}

export async function scanClaude(claudeHome: string, from: Date, to: Date): Promise<Candidate[]> {
  const projectsDir = join(claudeHome, "projects");
  let projectDirs: string[] = [];
  try { projectDirs = await readdir(projectsDir); } catch { return []; }
  const out: Candidate[] = [];
  for (const dir of projectDirs) {
    const full = join(projectsDir, dir);
    let entries: string[] = [];
    try { entries = await readdir(full); } catch { continue; }
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      const file = join(full, entry);
      let info; try { info = await stat(file); } catch { continue; }
      if (info.mtimeMs < from.getTime()) continue;
      const head = await peekJsonLines(file, 60);
      const first = head.find((r) => typeof r.timestamp === "string" && typeof r.cwd === "string" && (r.type === "user" || r.type === "assistant"));
      if (!first) continue;
      const startedAt = new Date(String(first.timestamp));
      // mtime >= from already guarantees the file was touched inside the range; sessions that
      // started earlier are kept and clipped later, sessions that start after the range are dropped.
      if (Number.isNaN(startedAt.getTime()) || startedAt > to) continue;
      out.push({
        provider: "claude", file, id: String(first.sessionId ?? entry.replace(/\.jsonl$/, "")), cwd: String(first.cwd),
        startedAt: startedAt.toISOString(), mtimeMs: info.mtimeMs, size: info.size, hiddenChildOf: null, forkedFrom: null,
      });
    }
  }
  return out;
}

interface PendingTool { name: string; input: Record<string, unknown>; at: string }

export async function parseClaude(candidate: Candidate): Promise<ExtractedSession> {
  const messages: Message[] = [];
  const decisions: Decision[] = [];
  const tools = new Map<string, PendingTool>();
  // Turn boundaries: real user messages and system notifications open a run; interrupts close one.
  const starters: Array<{ at: string; real: boolean }> = [];
  const activity: string[] = [];
  let branch: string | null = null;
  let cwd = candidate.cwd;
  let first: string | null = null;
  let last: string | null = null;
  let userMessages = 0;
  let decisionSeq = 0;
  let lastAssistantText = "";
  let lastMessageId: string | null = null;

  for await (const record of readJsonLines(candidate.file)) {
    if (record.isSidechain === true) continue;
    const at = typeof record.timestamp === "string" ? record.timestamp : null;
    if (!at) continue;
    if (!first || at < first) first = at; if (!last || at > last) last = at;
    if (typeof record.gitBranch === "string" && record.gitBranch && record.gitBranch !== "HEAD") branch = record.gitBranch;
    if (typeof record.cwd === "string" && record.cwd) cwd = record.cwd;
    const message = (record.message ?? {}) as Record<string, unknown>;
    const content = message.content;

    if (record.type === "user") {
      const text = textBlocks(content, ["text"]).trim();
      if (text) {
        if (text.startsWith(CLAUDE_INTERRUPT_PREFIX)) {
          activity.push(at);
          decisions.push({
            id: `d${++decisionSeq}`, at, kind: "interrupt", excerpt: lastSentence(lastAssistantText) || "（打断时 agent 还没有输出）",
            answer: null, next: null, detail: null,
          });
        } else if (startsWithAny(text, SYSTEM_PREFIXES)) {
          starters.push({ at, real: false });
          messages.push({ at, role: "system", text: clip(text, 200) });
        } else if (!startsWithAny(text, INJECTED_PREFIXES)) {
          starters.push({ at, real: true });
          userMessages += 1;
          messages.push({ at, role: "user", text });
        }
      }
      if (Array.isArray(content)) {
        for (const block of content as Array<Record<string, unknown>>) {
          if (!block || block.type !== "tool_result") continue;
          activity.push(at);
          const toolUseId = String(block.tool_use_id ?? "");
          const resultText = textBlocks(block.content, ["text"]);
          const tool = tools.get(toolUseId);
          if (tool?.name === CLAUDE_QUESTION_TOOL) {
            const target = decisions.find((d) => d.detail === toolUseId);
            if (target) { target.answer = parseClaudeAnswers(resultText) ?? clip(resultText, 200); target.detail = null; }
            // The user's answer resumes the agent: the silence before it is waiting, not running.
            starters.push({ at, real: true });
          } else if (block.is_error === true && resultText.trimStart().startsWith(CLAUDE_DENIED_PREFIX)) {
            const reason = resultText.match(/Reason:\s*(.+?)(?:\.\s|$)/);
            decisions.push({
              id: `d${++decisionSeq}`, at, kind: "denied",
              excerpt: clip(`${tool?.name ?? "工具"} ${tool ? toolTarget(tool.input) : ""}`),
              answer: null, next: null, detail: reason ? clip(reason[1]) : null,
            });
          }
        }
      }
      continue;
    }

    if (record.type === "assistant") {
      activity.push(at);
      const blocks = Array.isArray(content) ? (content as Array<Record<string, unknown>>) : [];
      const messageId = typeof message.id === "string" ? message.id : null;
      for (const block of blocks) {
        if (!block) continue;
        if (block.type === "text") {
          const text = String(block.text ?? "");
          if (!text.trim()) continue;
          lastAssistantText = text;
          const previous = messages[messages.length - 1];
          if (previous && previous.role === "assistant" && messageId && messageId === lastMessageId) previous.text += `\n${text}`;
          else messages.push({ at, role: "assistant", text });
          lastMessageId = messageId;
        } else if (block.type === "tool_use") {
          const name = String(block.name ?? "");
          const input = (block.input ?? {}) as Record<string, unknown>;
          const id = String(block.id ?? "");
          tools.set(id, { name, input, at });
          if (name === CLAUDE_QUESTION_TOOL) {
            const questions = Array.isArray(input.questions) ? (input.questions as Array<Record<string, unknown>>) : [];
            decisions.push({
              id: `d${++decisionSeq}`, at, kind: "question",
              excerpt: clip(questions.map((q) => String(q.question ?? "")).filter(Boolean).join(" / ") || "（提问）"),
              answer: null, next: null, detail: id,
            });
          } else if (CLAUDE_WRITE_TOOLS.has(name)) {
            const filePath = String(input.file_path ?? "");
            const match = filePath.match(CLAUDE_MEMORY_PATH);
            if (match) {
              decisions.push({
                id: `d${++decisionSeq}`, at, kind: memoryKind(match[1]), excerpt: memoryExcerpt(name, input),
                answer: null, next: null, detail: match[1],
              });
            }
          }
        }
      }
    }
  }

  // Unanswered questions keep `detail` as the tool id; clear it so the UI shows a plain pending state.
  for (const d of decisions) if (d.kind === "question" && d.detail?.startsWith("toolu_")) d.detail = null;

  const turns = buildTurns(starters, activity, first, last);
  const firstUser = messages.find((m) => m.role === "user");
  return {
    id: candidate.id, provider: "claude", file: candidate.file, cwd, branch,
    startedAt: first ?? candidate.startedAt, endedAt: last ?? candidate.startedAt,
    title: titleOf(firstUser?.text ?? ""), messages, turns,
    decisions: attachNext(decisions.sort((a, b) => a.at.localeCompare(b.at)), messages),
    userMessages, forkedFrom: null, hiddenThreads: [], error: null,
  };
}

export function titleOf(text: string): string {
  const summary = text.match(/Source agent:\s*(.+)/);
  const base = summary ? `（续）${summary[1]}` : text.replace(/<\/?pasted_content[^>]*>/g, " ");
  return clip(base, TITLE_MAX);
}

/** Longest silence inside one turn that still counts as the agent working. */
export const RUN_GAP_MS = 15 * 60_000;

/** Runs start at each starter and end at the last activity before the next starter; long silences split a run. */
export function buildTurns(startersIn: Array<{ at: string; real: boolean }>, activity: string[], first: string | null, last: string | null): Turn[] {
  const starters = [...startersIn].sort((a, b) => a.at.localeCompare(b.at));
  const sortedActivity = [...activity].sort();
  const turns: Turn[] = [];
  for (let i = 0; i < starters.length; i++) {
    const start = starters[i].at;
    const next = starters[i + 1] ?? null;
    // Activity that belongs to this turn, clustered by silence.
    const own = sortedActivity.filter((t) => t >= start && (!next || t < next.at));
    const clusters: Array<{ start: string; end: string }> = [{ start, end: start }];
    for (const t of own) {
      const current = clusters[clusters.length - 1];
      if (Date.parse(t) - Date.parse(current.end) > RUN_GAP_MS) clusters.push({ start: t, end: t });
      else if (t > current.end) current.end = t;
    }
    const lastCluster = clusters[clusters.length - 1];
    if (!next && last && last > lastCluster.end && Date.parse(last) - Date.parse(lastCluster.end) <= RUN_GAP_MS) lastCluster.end = last;
    clusters.forEach((cluster, index) => {
      const isLast = index === clusters.length - 1;
      turns.push({
        startedAt: cluster.start, endedAt: cluster.end,
        waitsForUser: isLast && !!next && next.real,
        nextStartedAt: isLast && next ? next.at : null,
      });
    });
  }
  if (turns.length === 0 && first && last) turns.push({ startedAt: first, endedAt: last, waitsForUser: false, nextStartedAt: null });
  return turns;
}
