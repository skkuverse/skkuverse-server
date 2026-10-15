// WHY: the crawler stores a missing text as "" as often as null; the wire says null for both.
export function textOrNull(value: string | null | undefined): string | null {
  return value || null;
}
