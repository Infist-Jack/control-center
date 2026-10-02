import type { Decision, DecisionKind } from "../shared/model.ts";
import { EXCERPT_MAX } from "../shared/model.ts";

// Fixed strings emitted by the CLIs. Tests pin them; a CLI upgrade that changes them fails loudly.
export const CLAUDE_INTERRUPT_PREFIX = "[Request interrupted by user";
export const CLAUDE_DENIED_PREFIX = "Permission for this action was denied";
export const CLAUDE_MEMORY_PATH = /\/\.claude\/projects\/[^/]+\/memory\/([^/]+\.md)$/;
export const CLAUDE_QUESTION_TOOL = "AskUserQuestion";
export const CLAUDE_WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);
export const CODEX_QUESTION_TOOL = "request_user_input_async";
export const CODEX_QUESTION_REPLY_TAG = "<send_user_message_question_reply>";
export const CODEX_INTERRUPT_REASON = "interrupted";

export function clip(text: string, max = EXCERPT_MAX): string {
  const single = text.replace(/\s+/g, " ").trim();
  if (single.length <= max) return single;
  return `${single.slice(0, max - 1)}…`;
}

export function firstSentence(text: string, max = 60): string {
  const single = text.replace(/\s+/g, " ").trim();
  const end = sentenceEnd(single, 0);
  return clip(end < 0 ? single : single.slice(0, end + 1), max);
}

/** Index of the first sentence terminator at or after `from`; a period only counts when followed by space or end. */
function sentenceEnd(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if ("。！？!?".includes(ch)) return i;
    if (ch === "." && (i === text.length - 1 || /\s/.test(text[i + 1]))) return i;
  }
  return -1;
}

export function lastSentence(text: string, max = EXCERPT_MAX): string {
  const single = text.replace(/\s+/g, " ").trim();
  const parts: string[] = [];
  let start = 0;
  while (start < single.length) {
    const end = sentenceEnd(single, start);
    if (end < 0) { parts.push(single.slice(start)); break; }
    parts.push(single.slice(start, end + 1));
    start = end + 1;
  }
  const last = [...parts].reverse().find((p) => p.trim().length > 0) ?? single;
  return clip(last, max);
}

export function parseClaudeAnswers(resultText: string): string | null {
  const pairs = [...resultText.matchAll(/"((?:[^"\\]|\\.)*)"="((?:[^"\\]|\\.)*)"/g)];
  if (pairs.length === 0) return null;
  return pairs.map((m) => m[2]).join(" / ");
}

export function memoryKind(fileName: string): DecisionKind {
  return fileName === "MEMORY.md" ? "memory-index" : "memory";
}

export function memoryExcerpt(toolName: string, input: Record<string, unknown>): string {
  if (toolName === "Write") {
    const content = String(input.content ?? "");
    const desc = content.match(/^description:\s*(.+)$/m);
    if (desc) return clip(desc[1]);
    const body = content.replace(/^---[\s\S]*?---\s*/, "");
    return clip(body);
  }
  if (toolName === "MultiEdit") {
    const edits = Array.isArray(input.edits) ? (input.edits as Array<Record<string, unknown>>) : [];
    return clip(String(edits[0]?.new_string ?? ""));
  }
  return clip(String(input.new_string ?? ""));
}

export function toolTarget(input: Record<string, unknown>): string {
  for (const key of ["command", "file_path", "path", "url", "pattern", "query"]) {
    if (typeof input[key] === "string" && input[key]) return String(input[key]);
  }
  return "";
}

/** Fill `next` with the first assistant sentence that follows each decision. */
export function attachNext(decisions: Decision[], messages: { at: string; role: string; text: string }[]): Decision[] {
  const assistant = messages.filter((m) => m.role === "assistant");
  return decisions.map((d) => {
    if (d.next) return d;
    const following = assistant.find((m) => m.at > d.at && m.text.trim().length > 0);
    return { ...d, next: following ? firstSentence(following.text) : null };
  });
}
