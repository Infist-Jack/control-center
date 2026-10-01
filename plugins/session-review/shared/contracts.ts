import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import {
  jobStatusSchema, presetSchema, progressSchema, providerSchema, reviewResultSchema, runtimeIdSchema,
  runtimeInfoSchema, scopeSchema, sessionDetailSchema, summarySchema,
} from "./model.ts";

export const catalogRpc = defineRpc({
  name: "catalog",
  input: z.object({}),
  output: z.object({
    projects: z.array(z.object({ id: z.string(), name: z.string(), rootPath: z.string() })),
    workspaces: z.array(z.object({ id: z.string(), projectId: z.string(), name: z.string(), cwd: z.string(), archived: z.boolean() })),
    runtimes: z.array(runtimeInfoSchema),
    presets: z.array(presetSchema),
    timezone: z.string(),
    today: z.string(),
    dataDir: z.string(),
  }),
});

export const reviewStartRpc = defineRpc({ name: "review.start", input: scopeSchema, output: z.object({ jobId: z.string() }) });
export const reviewStatusRpc = defineRpc({
  name: "review.status",
  input: z.object({ jobId: z.string() }),
  output: z.object({
    id: z.string(), status: jobStatusSchema, progress: progressSchema,
    result: reviewResultSchema.optional(), error: z.string().optional(),
  }),
});
export const sessionDetailRpc = defineRpc({
  name: "review.session",
  input: z.object({ provider: providerSchema, id: z.string() }),
  output: sessionDetailSchema,
});

export const summaryStartRpc = defineRpc({
  name: "summary.start",
  input: z.object({ scope: scopeSchema, runtime: runtimeIdSchema, presetId: z.string() }),
  output: z.object({ jobId: z.string() }),
});
export const summaryStatusRpc = defineRpc({
  name: "summary.status",
  input: z.object({ jobId: z.string() }),
  output: z.object({
    id: z.string(), status: jobStatusSchema, progress: progressSchema,
    result: summarySchema.optional(), error: z.string().optional(), stderrTail: z.string().optional(),
    cached: z.boolean().optional(),
  }),
});
export const summaryGetRpc = defineRpc({
  name: "summary.get",
  input: z.object({ scope: scopeSchema, runtime: runtimeIdSchema, presetId: z.string() }),
  output: z.object({ summary: summarySchema.nullable(), generatedAt: z.string().nullable() }),
});

export const presetSaveRpc = defineRpc({
  name: "presets.save",
  input: z.object({ id: z.string().optional(), name: z.string().min(1).max(60), body: z.string().max(20000) }),
  output: presetSchema,
});
export const presetDeleteRpc = defineRpc({ name: "presets.delete", input: z.object({ id: z.string() }), output: z.object({}) });
export const presetDefaultRpc = defineRpc({ name: "presets.default", input: z.object({ id: z.string() }), output: z.object({}) });
