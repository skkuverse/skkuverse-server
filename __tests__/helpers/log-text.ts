/**
 * One logger mock call flattened to text: the message, then every string and
 * number field and the items of every array field, joined with "; ".
 *
 * Log calls carry values as fields (`{ event, dropped: [...] }, "Sheet buttons
 * dropped"`), so a test that cares that a reason was reported — not where it
 * sits — matches against this instead of the message alone.
 */
export function logText(call: readonly unknown[] | undefined): string {
  if (!call) return "";
  const [fields, message] = call;
  const parts: string[] = typeof message === "string" ? [message] : [];
  if (fields && typeof fields === "object") {
    for (const value of Object.values(fields)) {
      if (Array.isArray(value)) parts.push(...value.map(String));
      else if (typeof value === "string" || typeof value === "number") parts.push(String(value));
    }
  }
  return parts.join("; ");
}
