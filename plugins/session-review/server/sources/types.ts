import type { Decision, Message, Provider } from "../../shared/model.ts";
import type { Turn } from "../spans.ts";

/** Normalised, redacted view of one provider session; this is what the cache stores. */
export interface ExtractedSession {
  id: string;
  provider: Provider;
  file: string;
  cwd: string;
  branch: string | null;
  startedAt: string;
  endedAt: string;
  title: string;
  messages: Message[];
  turns: Turn[];
  decisions: Decision[];
  userMessages: number;
  forkedFrom: string | null;
  hiddenThreads: string[];
  error: string | null;
}

export interface Candidate {
  provider: Provider;
  file: string;
  id: string;
  cwd: string;
  startedAt: string;
  mtimeMs: number;
  size: number;
  /** Codex child threads (guardian reviews, sub-agents) are folded into their parent and never parsed. */
  hiddenChildOf: string | null;
  forkedFrom: string | null;
}
