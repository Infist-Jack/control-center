import { z } from "zod";
import { summaryDaySchema, summarySchema, summarySessionSchema } from "../../shared/model.ts";

export const sessionsOnlySchema = z.object({ sessions: z.array(summarySessionSchema) });
export const dayOnlySchema = z.object({ day: summaryDaySchema });

export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
}

export { summarySchema };
