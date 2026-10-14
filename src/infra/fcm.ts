import config from "./config";
import type { PushPayload } from "./fcm.wire";
import logger from "./logger";

/**
 * WHY: the one POST to the `sendNotification` Cloud Function: each copy of fetch, abort on a timeout,
 * a body that may not be JSON and status-on-throw is a chance to lose the timeout and hang a request.
 */

export interface FcmResponse {
  sent?: number;
  failed?: number;
  cleanedUp?: number;
  [k: string]: unknown;
}

type FcmBody = FcmResponse | { raw: string } | null;

// WHY: callers treat a suppressed send as completed, so a local run still exercises claim → push → record.
const SUPPRESSED_RESPONSE: Readonly<FcmResponse> = Object.freeze({
  sent: 0,
  failed: 0,
  cleanedUp: 0,
  suppressed: true,
});

function logSuppressed(payload: PushPayload): void {
  const notice = payload.type === "notice" ? payload : undefined;
  const miniapp = payload.type === "miniapp" ? payload : undefined;
  logger.info(
    {
      event: "push.delivery.suppressed",
      type: payload.type,
      noticeId: notice?.noticeId,
      miniAppId: miniapp?.miniAppId,
      notificationId: miniapp?.notificationId,
      topics: notice?.topics,
      title_ko: payload.title_ko,
    },
    "Push suppressed (PUSH_DELIVERY=suppressed); the Cloud Function was not called",
  );
}

function parseBody(text: string): FcmBody {
  try {
    return text ? (JSON.parse(text) as FcmResponse) : null;
  } catch {
    return { raw: text };
  }
}

// WHY: `status` attached, so a caller can tell a rejected payload from a network that went away.
function toFcmError(status: number, body: FcmBody, text: string): Error & { status?: number } {
  const err = new Error(
    `sendNotification ${status}: ${typeof body === "object" ? JSON.stringify(body) : text}`,
  ) as Error & { status?: number };
  err.status = status;
  return err;
}

export async function postToFcmFunction(payload: PushPayload): Promise<FcmResponse> {
  if (config.push.delivery === "suppressed") {
    logSuppressed(payload);
    return { ...SUPPRESSED_RESPONSE };
  }
  const { functionUrl, apiKey, fcmTimeoutMs } = config.push;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), fcmTimeoutMs);
  try {
    const res = await fetch(functionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    const body = parseBody(text);
    if (!res.ok) throw toFcmError(res.status, body, text);
    return (body as FcmResponse) || {};
  } finally {
    clearTimeout(timer);
  }
}
