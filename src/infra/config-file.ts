import type { z } from "zod";

export function parseConfigFile<T>(label: string, schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`);
  throw new Error(`${label}: ${issues.join("; ")}`);
}
