import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { jobStatusSchema, progressSchema, providerSchema, reviewResultSchema, scopeSchema, sessionDetailSchema } from "./model.ts";

export const catalogRpc = defineRpc({
  name: "catalog",
  input: z.object({}),
  output: z.object({
    projects: z.array(z.object({ id: z.string(), name: z.string(), rootPath: z.string() })),
    /** Only used to map the panel's workspace to its project. */
    workspaces: z.array(z.object({ id: z.string(), projectId: z.string() })),
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
