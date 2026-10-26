/**
 * QUIRK(sentry): pino's lines are redacted before they are written, but the SDK builds error events from
 * the request and from outgoing-call breadcrumbs, whose URLs can carry a service key in the query or path.
 */
import type { Breadcrumb, ErrorEvent, Log } from "@sentry/nestjs";
import config from "./config";
import { maskQuery, maskUrl, pickHeaders } from "./log-redact";
import { isRecord } from "../shared/object.util";

// QUIRK(healthchecks): Healthchecks.io issues ping URLs on this host, and the path after it is the
// check's credential; the configured ping URL's own host counts too.
const HEALTHCHECKS_PING_HOST = "hc-ping.com";

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) scrubRequest(event.request);
  scrubQuotedUrls(event);
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((b) => scrubBreadcrumb(b)).filter((b) => b !== null);
  }
  return event;
}

function scrubRequest(request: NonNullable<ErrorEvent["request"]>): void {
  if (request.headers) request.headers = pickHeaders(request.headers);
  if (typeof request.url === "string") request.url = maskUrl(request.url);
  if (typeof request.query_string === "string") {
    request.query_string = maskQuery(request.query_string);
  } else if (request.query_string !== undefined) {
    delete request.query_string;
  }
  delete request.cookies;
  delete request.data;
}

function scrubQuotedUrls(event: ErrorEvent): void {
  if (typeof event.message === "string") event.message = maskUrlsInText(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = maskUrlsInText(exception.value);
  }
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.message) breadcrumb.message = maskUrlsInText(breadcrumb.message);
  const data = breadcrumb.data;
  if (data) {
    if (typeof data.url === "string" && isHealthchecksPingUrl(data.url)) return null;
    if (typeof data.url === "string") data.url = maskUrl(data.url);
    // QUIRK(sentry): an outgoing call's query and fragment travel apart from its url.
    delete data["http.query"];
    delete data["http.fragment"];
  }
  return breadcrumb;
}

const URL_IN_TEXT = /https?:\/\/[^\s"'<>]+/gi;

// WHY: an error or a console line may quote the URL it called, key and all.
function maskUrlsInText(text: string): string {
  return text.replace(URL_IN_TEXT, (url) => (isHealthchecksPingUrl(url) ? toPathlessUrl(url) : maskUrl(url)));
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isHealthchecksPingUrl(url: string): boolean {
  const host = hostOf(url);
  if (host === null) return false;
  const configuredUrl = config.healthchecks.pollerPingUrl();
  const configuredHost = configuredUrl === undefined ? null : hostOf(configuredUrl);
  return host === HEALTHCHECKS_PING_HOST || host === configuredHost;
}

function toPathlessUrl(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}/[REDACTED]`;
}

const MAX_FLATTEN_DEPTH = 2;

/**
 * QUIRK(sentry): a nested attribute is stored as one JSON string, which cannot be filtered on;
 * `res.statusCode` makes "every 5xx in the last hour" a query. Keys stop at three segments.
 */
export function flattenLogAttributes(log: Log): Log {
  if (!log.attributes) return log;
  const flat: Record<string, unknown> = {};
  const put = (prefix: string, value: unknown, depth: number): void => {
    if (isRecord(value) && depth < MAX_FLATTEN_DEPTH) {
      for (const [key, nested] of Object.entries(value)) put(`${prefix}.${key}`, nested, depth + 1);
      return;
    }
    flat[prefix] = value;
  };
  for (const [key, value] of Object.entries(log.attributes)) put(key, value, 0);
  return { ...log, attributes: flat };
}
