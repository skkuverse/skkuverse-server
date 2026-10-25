import http from "node:http";
import https from "node:https";
import type { AxiosRequestConfig } from "axios";
import { createGuardedLookup } from "./guarded-lookup.util";
import { OutboundBlockedError } from "./outbound-blocked.error";
import { parseAllowedUrl, parseOutboundUrl } from "./outbound-url.util";

// WHY: a user-supplied URL passes two checks on every hop: the URL policy (an IP literal is checked there, since Node
// skips `lookup` for one) and the address policy, inside the socket's own DNS lookup, so DNS rebinding is covered.
// The caller owns the domain allowlist, if any: no process-wide egress list lives here.

export const MAX_REDIRECTS = 5;

interface RedirectOptions {
  href?: string;
  protocol?: string;
  hostname?: string;
  port?: string | number;
  path?: string;
}

type UrlCheck = (url: string) => URL | null;

// QUIRK(axios): follow-redirects calls `beforeRedirect` per hop, so the URL policy holds on every hop.
function assertRedirectPasses(options: RedirectOptions, check: UrlCheck): void {
  const port = options.port ? `:${options.port}` : "";
  const target = options.href ?? `${options.protocol ?? ""}//${options.hostname ?? ""}${port}${options.path ?? ""}`;
  if (!check(target)) throw new OutboundBlockedError(`redirect to ${target} is not allowed`);
}

export function assertRedirectAllowed(options: RedirectOptions, allowedDomains: readonly string[]): void {
  assertRedirectPasses(options, (url) => parseAllowedUrl(url, allowedDomains));
}

const guardedLookup = createGuardedLookup();
const agentOptions = { keepAlive: true, maxSockets: 32, lookup: guardedLookup };
const httpAgent = new http.Agent(agentOptions);
const httpsAgent = new https.Agent(agentOptions);

// QUIRK(axios): `proxy: false`, or HTTP(S)_PROXY would move DNS resolution to the proxy and skip the address check.
function guardedConfig(check: UrlCheck): AxiosRequestConfig {
  return { httpAgent, httpsAgent, proxy: false, maxRedirects: MAX_REDIRECTS, beforeRedirect: (options) => assertRedirectPasses(options, check) };
}

export function guardedRequestConfig(allowedDomains: readonly string[]): AxiosRequestConfig {
  return guardedConfig((url) => parseAllowedUrl(url, allowedDomains));
}

export function guardedPublicRequestConfig(): AxiosRequestConfig {
  return guardedConfig(parseOutboundUrl);
}

export function isOutboundBlocked(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth++) {
    if (current instanceof OutboundBlockedError) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
