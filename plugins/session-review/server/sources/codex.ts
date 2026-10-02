import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Decision, Message } from "../../shared/model.ts";
import { CODEX_INTERRUPT_REASON, CODEX_QUESTION_REPLY_TAG, CODEX_QUESTION_TOOL, attachNext, clip, lastSentence } from "../decisions.ts";
import type { Turn } from "../spans.ts";
import { peekJsonLines, readJsonLines, textBlocks } from "./jsonl.ts";
import { titleOf } from "./claude.ts";
import type { Candidate, ExtractedSession } from "./types.ts";

const INJECTED_PREFIXES = ["# AGENTS.md", "<environment_context>", "<skills_instructions>", "<turn_aborted>", "<codex_internal_context", "<permissions", "<user_shell"];

function dayKeys(from: Date, to: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  while (cursor <= to) {
    keys.push(`${cursor.getFullYear()}/${String(cursor.getMonth() + 1).padStart(2, "0")}/${String(cursor.getDate()).padStart(2, "0")}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

async function candidateFromFile(file: string, from: Date, to: Date): Promise<Candidate | null> {
  let info; try { info = await stat(file); } catch { return null; }
  if (info.mtimeMs < from.getTime()) return null;
  const head = await peekJsonLines(file, 3);
  const meta = head.find((r) => r.type === "session_meta");
  if (!meta) return null;
  const payload = (meta.payload ?? {}) as Record<string, unknown>;
  const startedAt = new Date(String(payload.timestamp ?? meta.timestamp ?? ""));
  if (Number.isNaN(startedAt.getTime()) || startedAt > to) return null;
  return {
    provider: "codex", file, id: String(payload.id ?? ""), cwd: String(payload.cwd ?? ""),
    startedAt: startedAt.toISOString(), mtimeMs: info.mtimeMs, size: info.size,
    hiddenChildOf: typeof payload.parent_thread_id === "string" ? payload.parent_thread_id : null,
    forkedFrom: typeof payload.forked_from_id === "string" ? payload.forked_from_id : null,
  };
}

/** Codex files live in the directory of the day they started; a thread resumed later keeps appending there. */
const LOOKBACK_DAYS = 30;

export async function scanCodex(codexHome: string, from: Date, to: Date): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const lookbackStart = new Date(from); lookbackStart.setDate(lookbackStart.getDate() - LOOKBACK_DAYS);
  for (const key of dayKeys(lookbackStart, to)) {
    const dir = join(codexHome, "sessions", key);
    let entries: string[] = [];
    try { entries = await readdir(dir); } catch { continue; }
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      const candidate = await candidateFromFile(join(dir, entry), from, to);
      if (candidate) out.push(candidate);
    }
  }
  const archived = join(codexHome, "archived_sessions");
  let archivedEntries: string[] = [];
  try { archivedEntries = await readdir(archived); } catch { archivedEntries = []; }
  const wanted = new Set(dayKeys(lookbackStart, to).map((k) => k.replaceAll("/", "-")));
  for (const entry of archivedEntries) {
    const match = entry.match(/^rollout-(\d{4}-\d{2}-\d{2})T/);
    if (!match || !wanted.has(match[1]) || !entry.endsWith(".jsonl")) continue;
    const candidate = await candidateFromFile(join(archived, entry), from, to);
    if (candidate) out.push(candidate);
  }
  return out;
}

export async function parseCodex(candidate: Candidate): Promise<ExtractedSession> {
  const messages: Message[] = [];
  const decisions: Decision[] = [];
  const turns: Turn[] = [];
  let open: { startedAt: string } | null = null;
  let first: string | null = null;
  let last: string | null = null;
  let userMessages = 0;
  let decisionSeq = 0;
  let lastAssistantText = "";
  let sawUserSinceTurnEnd = false;

  const closeTurn = (at: string) => {
    if (!open) return;
    turns.push({ startedAt: open.startedAt, endedAt: at, waitsForUser: false, nextStartedAt: null });
    open = null;
    sawUserSinceTurnEnd = false;
  };

  for await (const record of readJsonLines(candidate.file)) {
    const at = typeof record.timestamp === "string" ? record.timestamp : null;
    if (!at) continue;
    if (!first || at < first) first = at; if (!last || at > last) last = at;
    const payload = (record.payload ?? {}) as Record<string, unknown>;

    if (record.type === "event_msg") {
      if (payload.type === "task_started") { closeTurn(at); open = { startedAt: at }; }
      else if (payload.type === "task_complete") closeTurn(at);
      else if (payload.type === "turn_aborted") {
        if (payload.reason === CODEX_INTERRUPT_REASON) {
          decisions.push({
            id: `d${++decisionSeq}`, at, kind: "interrupt", excerpt: lastSentence(lastAssistantText) || "（打断时 agent 还没有输出）",
            answer: null, next: null, detail: null,
          });
        }
        closeTurn(at);
      }
      continue;
    }

    if (record.type !== "response_item") continue;
    if (payload.type === "message") {
      const text = textBlocks(payload.content, ["input_text", "output_text"]).trim();
      if (!text) continue;
      if (payload.role === "user") {
        if (text.includes(CODEX_QUESTION_REPLY_TAG)) {
          const json = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
          let answer = clip(text.replace(CODEX_QUESTION_REPLY_TAG, "").replace(/<\/?[a-z_]+>/g, ""), 200);
          if (json) {
            try {
              const replies = JSON.parse(json[0]) as Array<Record<string, unknown>>;
              answer = replies.map((r) => String(r.answer ?? "")).filter(Boolean).join(" / ") || answer;
            } catch { /* keep the clipped text */ }
          }
          const pending = [...decisions].reverse().find((d) => d.kind === "question" && d.answer === null);
          if (pending) pending.answer = answer;
          userMessages += 1;
          messages.push({ at, role: "user", text: `回答：${answer}` });
          sawUserSinceTurnEnd = true;
        } else if (!INJECTED_PREFIXES.some((p) => text.startsWith(p))) {
          userMessages += 1;
          messages.push({ at, role: "user", text });
          sawUserSinceTurnEnd = true;
        }
      } else if (payload.role === "assistant") {
        lastAssistantText = text;
        messages.push({ at, role: "assistant", text });
      }
    } else if (payload.type === "function_call" && payload.name === CODEX_QUESTION_TOOL) {
      let excerpt = "（提问）";
      try {
        const args = JSON.parse(String(payload.arguments ?? "{}")) as Record<string, unknown>;
        const questions = Array.isArray(args.questions) ? (args.questions as Array<Record<string, unknown>>) : [];
        excerpt = clip(questions.map((q) => String(q.title ?? q.question ?? "")).filter(Boolean).join(" / ")) || excerpt;
      } catch { /* keep placeholder */ }
      decisions.push({ id: `d${++decisionSeq}`, at, kind: "question", excerpt, answer: null, next: null, detail: null });
    }
  }
  if (open && last) closeTurn(last);
  void sawUserSinceTurnEnd;

  // A gap between two turns counts as waiting only when the next turn exists (the user had to come back).
  for (let i = 0; i < turns.length; i++) {
    const next = turns[i + 1];
    if (next) { turns[i].waitsForUser = true; turns[i].nextStartedAt = next.startedAt; }
  }
  const firstUser = messages.find((m) => m.role === "user");
  return {
    id: candidate.id, provider: "codex", file: candidate.file, cwd: candidate.cwd, branch: null,
    startedAt: first ?? candidate.startedAt, endedAt: last ?? candidate.startedAt,
    title: titleOf(firstUser?.text ?? ""), messages, turns,
    decisions: attachNext(decisions, messages), userMessages,
    forkedFrom: candidate.forkedFrom, hiddenThreads: [], error: null,
  };
}
