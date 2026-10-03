import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { progressSchema, providerSchema, reviewResultSchema, scopeSchema, sessionDetailSchema, nodeSchema, projectSchema } from "./model.ts";

export const catalogSchema = z.object({
    projects: z.array(projectSchema),
    nodes: z.array(nodeSchema),
    /** Only used to map the panel's workspace to its project. */
    workspaces: z.array(z.object({ id: z.string(), projectId: z.string() })),
    timezone: z.string(),
    today: z.string(),
    dataDir: z.string(),
});
export type ReviewCatalog = z.infer<typeof catalogSchema>;
export const catalogRpc = defineRpc({ name: "catalog", input: z.object({}), output: catalogSchema });

export const reviewReadRpc = defineRpc({
  name: "review.read", input: scopeSchema,
  output: z.object({
    refreshing: z.boolean(), progress: progressSchema.optional(),
    result: reviewResultSchema.optional(), error: z.string().optional(),
  }),
});
export const reviewRefreshRpc = defineRpc({ name: "review.refresh", input: scopeSchema, output: z.object({}) });
export const sessionDetailRpc = defineRpc({
  name: "review.session",
  input: z.object({ provider: providerSchema, id: z.string(), nodeId: z.string().optional(), offset: z.number().int().min(0).default(0) }),
  output: sessionDetailSchema,
});
