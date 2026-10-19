// WHY: a detail takes a stored manifest only for a startUrl on a first-party origin, so a third party is never restyled.
export function firstPartyOrigin(startUrl: string, origins: readonly string[]): string | null {
  if (!URL.canParse(startUrl)) return null;
  const { origin } = new URL(startUrl);
  return origins.includes(origin) ? origin : null;
}
