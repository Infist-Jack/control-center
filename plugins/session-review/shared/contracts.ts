import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { progressSchema, providerSchema, reviewResultSchema, scopeSchema, sessionDetailSchema, nodeSchema, projectSchema } from "./model.ts";

export const registryInfoSchema = z.object({
    /** none: nothing configured; ready: registry readable; missing: configured but absent; failed: unreadable. */
    status: z.enum(["none", "ready", "missing", "failed"]),
    path: z.string().optional(),
    message: z.string(),
});
export type RegistryInfo = z.infer<typeof registryInfoSchema>;

export const catalogSchema = z.object({
    projects: z.array(projectSchema),
    nodes: z.array(nodeSchema),
    /** This daemon; always reviewed, with or without a registry of other nodes. */
    local: z.object({ id: z.string(), name: z.string() }).optional(),
    registry: registryInfoSchema.optional(),
    warnings: z.array(z.string()).optional(),
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
