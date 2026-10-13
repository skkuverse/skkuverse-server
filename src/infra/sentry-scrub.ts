/**
 * (A credential detail is left out of the public history.)
 */
import type { Breadcrumb, ErrorEvent, Log } from "@sentry/nestjs";
import { maskQuery, maskUrl, pickHeaders } from "./log-redact";
import { isRecord } from "../shared/object.util";

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const request = event.request;
  if (request) {
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
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((b) => scrubBreadcrumb(b)).filter((b) => b !== null);
  }
  return event;
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  const data = breadcrumb.data;
  if (data) {
    if (typeof data.url === "string") data.url = maskUrl(data.url);
    // QUIRK(sentry): an outgoing call's query and fragment travel apart from its url.
    delete data["http.query"];
    delete data["http.fragment"];
  }
  return breadcrumb;
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
