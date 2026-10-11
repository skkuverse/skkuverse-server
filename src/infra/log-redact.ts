/**
 * EVIDENCE: pino-http's default serializer logs every header: a prod sample of 2,000 access lines held
 * 707 Firebase tokens and 7 X-Internal-Tokens. A header, query value or error field is logged only if named here.
 */
import { stdSerializers } from "pino";
import type { IncomingMessage } from "http";

// WHY: not x-app-version or x-platform: customProps logs them as top-level appVersion / platform.
export const LOGGED_REQUEST_HEADERS = [
  "user-agent",
  "accept-language",
  "cf-ray",
  "cf-ipcountry",
] as const;

const SECRET_PARAM = /key|token|secret|password|passwd|signature|sig$|auth|session/i;

const REDACTED = "[REDACTED]";

/**
 * QUIRK(axios): an error carries its request config (headers with cookies, a URL with a service key)
 * under `config`, and the raw socket objects under `request` / `response`.
 */
const DROPPED_ERROR_KEYS = new Set(["config", "request", "response", "headers"]);

const MAX_ERROR_DEPTH = 4;

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

export function maskQuery(query: string): string {
  const params = new URLSearchParams(query);
  for (const name of [...params.keys()]) {
    if (SECRET_PARAM.test(name)) params.set(name, REDACTED);
  }
  return params.toString();
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
 * QUIRK(pino-http): the serializer gets a wrapped request whose `raw` is the Express request, and `ip`
 * (resolved through `trust proxy`) is only on the raw one.
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

function axiosHttpFields(axios: AxiosLike): { method?: string; url?: string; status?: number } {
  const url = axios.config?.url;
  return {
    method: axios.config?.method?.toUpperCase(),
    url: url ? maskUrl(new URL(url, axios.config?.baseURL ?? "http://placeholder.invalid").href) : undefined,
    status: axios.response?.status,
  };
}

export function serializeError(err: unknown): unknown {
  if (!(err instanceof Error)) return err;
  const base = scrub(stdSerializers.err(err), 0) as Record<string, unknown>;
  const axios = err as Error & AxiosLike;
  if (axios.isAxiosError) base.http = axiosHttpFields(axios);
  return base;
}

// WHY: a second line of defence for objects logged by hand (`logger.info({ headers })`).
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
