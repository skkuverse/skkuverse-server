import { AppError } from "../../http/app.error";
import { RATE_LIMITED_BODY } from "../../perimeter/perimeter.ports";
import { isRecord } from "../../shared/object.util";
import type { DeliveryError } from "../miniapps.document";

/**
 * WHY: refusals before any send: the function's own 400/401/405 and the platform's 403/404/413/429. An
 * allowlist, not "any 4xx", so a status nobody reasoned about (a 408, a proxy's) fails safe as unknown.
 */
const NOT_SENT_STATUSES: ReadonlySet<number> = new Set([400, 401, 403, 404, 405, 413, 429]);

const statusOf = (err: unknown): unknown => (isRecord(err) ? err.status : undefined);

// WHY: only a refusal before sending is safe to retry; a timeout, a network error or a 5xx may have reached devices.
export function classifyDeliveryFailure(err: unknown): DeliveryError["outcome"] {
  const status = statusOf(err);
  return typeof status === "number" && NOT_SENT_STATUSES.has(status) ? "not_sent" : "unknown";
}

export function toQuotaRefusal(): AppError {
  return new AppError(RATE_LIMITED_BODY.error.code, RATE_LIMITED_BODY.error.message, 429);
}
