import net from "node:net";
import { isPublicAddress } from "./ip-address.util";

export function isAllowedHost(hostname: string, allowedDomains: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return allowedDomains.some(
    (d) => host === d || host.endsWith(`.${d}`),
  );
}

// WHY: Node skips the socket's DNS lookup for an IP literal, so the address check runs on the URL instead.
function isNonPublicLiteral(hostname: string): boolean {
  const literal = hostname.replace(/^\[(.*)\]$/, "$1");
  return net.isIP(literal) !== 0 && !isPublicAddress(literal);
}

export function parseOutboundUrl(raw: string): URL | null {
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
  if (isNonPublicLiteral(parsed.hostname)) return null;
  return parsed;
}

export function parseAllowedUrl(raw: string, allowedDomains: readonly string[]): URL | null {
  const parsed = parseOutboundUrl(raw);
  return parsed && isAllowedHost(parsed.hostname, allowedDomains) ? parsed : null;
}
