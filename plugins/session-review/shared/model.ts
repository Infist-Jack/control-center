import { z } from "zod";

export const providerSchema = z.enum(["claude", "codex"]);
export type Provider = z.infer<typeof providerSchema>;

export const decisionKindSchema = z.enum(["question", "interrupt", "denied", "memory", "memory-index"]);
export type DecisionKind = z.infer<typeof decisionKindSchema>;

export const decisionSchema = z.object({
  id: z.string(),
  at: z.string(),
  kind: decisionKindSchema,
  excerpt: z.string(),
  answer: z.string().nullable(),
  next: z.string().nullable(),
  detail: z.string().nullable(),
});
export type Decision = z.infer<typeof decisionSchema>;

export const spanSchema = z.object({ kind: z.enum(["run", "wait"]), start: z.string(), end: z.string() });
export type Span = z.infer<typeof spanSchema>;

export const sessionCardSchema = z.object({
  id: z.string(),
  provider: providerSchema,
  title: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
  activeMs: z.number(),
  waitMs: z.number(),
  userMessages: z.number(),
  agentId: z.string().nullable(),
  projectId: z.string().nullable(),
  branch: z.string().nullable(),
  cwd: z.string(),
  forkedFrom: z.string().nullable(),
  depth: z.number(),
  hiddenThreads: z.number(),
  spans: z.array(spanSchema),
  decisions: z.array(decisionSchema),
  error: z.string().nullable(),
  file: z.string(),
});
export type SessionCard = z.infer<typeof sessionCardSchema>;

export const overviewSchema = z.object({
  sessions: z.number(),
  peakParallel: z.number(),
  activeMs: z.number(),
  waitMs: z.number(),
  decisions: z.number(),
  unparsable: z.number(),
});
export type Overview = z.infer<typeof overviewSchema>;

export const rangeSchema = z.object({
  kind: z.enum(["today", "yesterday", "last7", "custom"]),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type Range = z.infer<typeof rangeSchema>;

export const scopeSchema = z.object({
  projectId: z.string().nullable().optional(),
  range: rangeSchema,
  branch: z.string().nullable().optional(),
});
export type Scope = z.infer<typeof scopeSchema>;

export const reviewResultSchema = z.object({
  scope: scopeSchema,
  from: z.string(),
  to: z.string(),
  timezone: z.string(),
  generatedAt: z.string(),
  overview: overviewSchema,
  sessions: z.array(sessionCardSchema),
});
export type ReviewResult = z.infer<typeof reviewResultSchema>;

export const messageSchema = z.object({ at: z.string(), role: z.enum(["user", "assistant", "system"]), text: z.string() });
export type Message = z.infer<typeof messageSchema>;

export const sessionDetailSchema = z.object({
  id: z.string(),
  provider: providerSchema,
  title: z.string(),
  cwd: z.string(),
  file: z.string(),
  messages: z.array(messageSchema),
  decisions: z.array(decisionSchema),
});
export type SessionDetail = z.infer<typeof sessionDetailSchema>;

export const jobStatusSchema = z.enum(["running", "succeeded", "failed"]);
export const progressSchema = z.object({ phase: z.string(), done: z.number(), total: z.number() });
export type Progress = z.infer<typeof progressSchema>;

export const TITLE_MAX = 60;
export const EXCERPT_MAX = 100;
export const MESSAGE_MAX = 2000;
export const SESSION_LIMIT = 200;
