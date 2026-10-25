import http from "node:http";
import https from "node:https";
import type { AxiosRequestConfig } from "axios";
import { createGuardedLookup } from "./guarded-lookup.util";
import { OutboundBlockedError } from "./outbound-blocked.error";
import { parseAllowedUrl } from "./outbound-url.util";

// WHY: a user-supplied URL passes two checks on every hop: the URL policy (an IP literal never matches it, and Node
// skips `lookup` for one) and the address policy, inside the socket's own DNS lookup, so DNS rebinding is covered.
// The caller owns the domain allowlist: no process-wide egress list lives here.

export const MAX_REDIRECTS = 5;

interface RedirectOptions {
  href?: string;
  protocol?: string;
  hostname?: string;
  port?: string | number;
  path?: string;
}

// QUIRK(axios): follow-redirects calls `beforeRedirect` per hop, so the URL policy holds on every hop.
export function assertRedirectAllowed(options: RedirectOptions, allowedDomains: readonly string[]): void {
  const target =
    options.href ??
    `${options.protocol ?? ""}//${options.hostname ?? ""}${
      options.port ? `:${options.port}` : ""
    }${options.path ?? ""}`;
  if (!parseAllowedUrl(target, allowedDomains)) {
    throw new OutboundBlockedError(`redirect to ${target} is not allowed`);
  }
}

const guardedLookup = createGuardedLookup();
const agentOptions = { keepAlive: true, maxSockets: 32, lookup: guardedLookup };
const httpAgent = new http.Agent(agentOptions);
const httpsAgent = new https.Agent(agentOptions);

// QUIRK(axios): `proxy: false`, or HTTP(S)_PROXY would move DNS resolution to the proxy and skip the address check.
export function guardedRequestConfig(allowedDomains: readonly string[]): AxiosRequestConfig {
  return {
    httpAgent,
    httpsAgent,
    proxy: false,
    maxRedirects: MAX_REDIRECTS,
    beforeRedirect: (options) => assertRedirectAllowed(options, allowedDomains),
  };
}

export function isOutboundBlocked(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth++) {
    if (current instanceof OutboundBlockedError) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
