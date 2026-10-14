import type { z } from "zod";

// WHY: an error map words each issue from its full path, for a file whose messages name an entry by its id.
export interface WordedConfigFile {
  label: string;
  error: z.core.$ZodErrorMap;
}

export function parseConfigFile<T>(file: string | WordedConfigFile, schema: z.ZodType<T>, raw: unknown): T {
  const { label, error } = typeof file === "string" ? { label: file, error: undefined } : file;
  const parsed = schema.safeParse(raw, { error });
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`);
  throw new Error(`${label}: ${issues.join("; ")}`);
}
