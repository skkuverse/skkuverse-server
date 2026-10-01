/**
 * What may leave the process in a log line.
 *
 * Until 2026-10 pino-http's default request serializer wrote every request
 * header, so each access line carried the caller's Firebase `Authorization`
 * token and every call to /internal/* carried `X-Internal-Token` (a prod sample
 * of 2000 lines held 707 and 7 of them). The rule since then is an allowlist:
 * a header, query value or error field is logged only if it is named here.
 *
 * These helpers are pure so the Sentry hooks can reuse them on the same data.
 */
import { stdSerializers } from "pino";
import type { IncomingMessage } from "http";

/**
 * Request headers worth a field in every access line. Nothing else is logged.
 * (x-app-version and x-platform are top-level `appVersion` / `platform`, set by
 * the access logger's customProps.)
 */
export const LOGGED_REQUEST_HEADERS = [
  "user-agent",
  "accept-language",
  "cf-ray",
  "cf-ipcountry",
] as const;

/** Query parameter names whose values are never logged. */
const SECRET_PARAM = /key|token|secret|password|passwd|signature|sig$|auth|session/i;

const REDACTED = "[REDACTED]";

/**
 * Keys dropped from serialized errors at any depth. An axios error carries its
 * request config (headers with cookies, the URL with a service key) under
 * `config`, and the raw socket objects under `request` / `response`.
 */
const DROPPED_ERROR_KEYS = new Set(["config", "request", "response", "headers"]);

const MAX_ERROR_DEPTH = 4;

/**
 * Path plus query, with the value of every secret-looking parameter masked.
 * Accepts absolute and relative URLs; anything unparseable is returned as its
 * path only (everything before `?`), never verbatim.
 */
export function maskUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url, "http://placeholder.invalid");
  } catch {
    return url.split("?")[0] ?? "";
  }
  for (const name of [...parsed.searchParams.keys()]) {
    if (SECRET_PARAM.test(name)) parsed.searchParams.set(name, REDACTED);
  }
  const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
  const prefix = absolute ? `${parsed.protocol}//${parsed.host}` : "";
  return `${prefix}${parsed.pathname}${parsed.search}`;
}

export function pickHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of LOGGED_REQUEST_HEADERS) {
    const value = headers[name];
    if (value !== undefined) out[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

interface LoggedRequest {
  id: unknown;
  method: string | undefined;
  url: string;
  ip: string | undefined;
  headers: Record<string, string>;
}

/**
 * pino-http hands the serializer a wrapped request whose `raw` is the Express
 * request; `ip` (resolved through `trust proxy`) is only on the raw one.
 */
export function serializeRequest(req: {
  id?: unknown;
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  remoteAddress?: string;
  raw?: IncomingMessage & { ip?: string; originalUrl?: string };
}): LoggedRequest {
  const raw = req.raw;
  return {
    id: req.id,
    method: req.method,
    url: maskUrl(raw?.originalUrl ?? req.url ?? ""),
    ip: raw?.ip ?? req.remoteAddress,
    headers: pickHeaders(req.headers ?? raw?.headers ?? {}),
  };
}

export function serializeResponse(res: { statusCode?: number }): { statusCode?: number } {
  return { statusCode: res.statusCode };
}

function scrub(value: unknown, depth: number): unknown {
  if (value === null || typeof value !== "object") return value;
  if (depth > MAX_ERROR_DEPTH) return "[Truncated]";
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (DROPPED_ERROR_KEYS.has(key)) continue;
    out[key] = key === "url" && typeof v === "string" ? maskUrl(v) : scrub(v, depth + 1);
  }
  return out;
}

interface AxiosLike {
  isAxiosError?: boolean;
  config?: { method?: string; url?: string; baseURL?: string };
  response?: { status?: number };
}

/**
 * pino's error serializer (type, message, stack, cause, enumerable fields),
 * minus request config and raw sockets at every depth. An axios error keeps
 * what a reader needs to place it: method, masked URL and response status.
 */
export function serializeError(err: unknown): unknown {
  if (!(err instanceof Error)) return err;
  const base = scrub(stdSerializers.err(err), 0) as Record<string, unknown>;
  const axios = err as Error & AxiosLike;
  if (axios.isAxiosError) {
    const url = axios.config?.url;
    base.http = {
      method: axios.config?.method?.toUpperCase(),
      url: url ? maskUrl(new URL(url, axios.config?.baseURL ?? "http://placeholder.invalid").href) : undefined,
      status: axios.response?.status,
    };
  }
  return base;
}

/**
 * Second line of defence for objects logged by hand (`logger.info({ headers })`).
 * The serializers above already keep these out of `req` and `err`.
 */
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-internal-token"]',
  "headers.authorization",
  "headers.cookie",
  'headers["x-internal-token"]',
  "authorization",
  "cookie",
  "token",
  "idToken",
  "internalToken",
];
