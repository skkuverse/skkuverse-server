// WHY: only a startUrl on a first-party origin is fetched at all: this server never reaches a host it does not run.
export function firstPartyOrigin(startUrl: string, origins: readonly string[]): string | null {
  if (!URL.canParse(startUrl)) return null;
  const { origin } = new URL(startUrl);
  return origins.includes(origin) ? origin : null;
}
