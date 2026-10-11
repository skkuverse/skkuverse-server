import type { z } from "zod";

interface ParsedList<T> {
  valid: T[];
  invalid: string[];
}

export function issuePaths(error: z.ZodError): string {
  const paths = error.issues.map((issue) => issue.path.join(".") || "(root)");
  return [...new Set(paths)].join(", ");
}

/** WHY: one bad item must not cost the others; each is named `<key>: <issue paths>` for the caller to log. */
export function parseEach<T>(
  items: readonly unknown[],
  schema: z.ZodType<T>,
  keyOf: (item: unknown, index: number) => string,
): ParsedList<T> {
  const valid: T[] = [];
  const invalid: string[] = [];
  items.forEach((item, index) => {
    const parsed = schema.safeParse(item);
    if (parsed.success) valid.push(parsed.data);
    else invalid.push(`${keyOf(item, index)}: ${issuePaths(parsed.error)}`);
  });
  return { valid, invalid };
}
