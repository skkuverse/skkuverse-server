export function isAllowedHost(hostname: string, allowedDomains: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return allowedDomains.some(
    (d) => host === d || host.endsWith(`.${d}`),
  );
}

export function parseAllowedUrl(raw: string, allowedDomains: readonly string[]): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  // QUIRK(whatwg): URL normalises an explicit default port (":443" on https) to "".
  if (parsed.port !== "") return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  if (!isAllowedHost(parsed.hostname, allowedDomains)) return null;
  return parsed;
}
