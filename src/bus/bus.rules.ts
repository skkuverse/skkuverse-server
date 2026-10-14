// QUIRK(topis): a raw base64 key (`+`, `=`, `/`) splits the query string and TOPIS rejects it as if it
// were down, so the key must be stored URL-encoded.
const URL_ENCODED_KEY = /^[A-Za-z0-9_%-]+$/;

export const SERVICE_KEY_REQUIRED = "SEOUL_BUS_SERVICE_KEY is required (see config/env.prd.keys)";

export function validateServiceKey(key: unknown): string[] {
  if (typeof key !== "string" || key.length === 0) return [SERVICE_KEY_REQUIRED];
  if (URL_ENCODED_KEY.test(key)) return [];
  return [
    "SEOUL_BUS_SERVICE_KEY must be URL-encoded (allowed chars: [A-Za-z0-9_%-]). " +
      "Re-encode the raw key with encodeURIComponent() before storing in .env.",
  ];
}

// QUIRK(topis): some loops list their first stop again as the last ord (02: ord 1 and ord 27).
export function isLoopClosingRepeat(topisIds: readonly string[], index: number): boolean {
  return index > 0 && index === topisIds.length - 1 && topisIds[index] === topisIds[0];
}
