/**
 * NoticesDispatchClient with a scripted outcome: `response` is what the Cloud Function answers, or `error` what
 * the call rejects with (notices-dispatch.client.spec.ts covers the real payload). `pushes` records every send.
 */
import type { NoticesDispatchClient } from "../../../../src/notices/dispatch/notices-dispatch.client";
import type { FcmResponse } from "../../../../src/infra/fcm";
import type { NoticeDoc } from "../../../../src/notices/notices.document";
import type { PublicOf } from "../public-of";

export class FakeNoticesDispatchClient implements PublicOf<NoticesDispatchClient> {
  response: FcmResponse = { sent: 1, failed: 0, cleanedUp: 0 };
  error: Error | null = null;
  pushes: Array<{ notice: NoticeDoc; topics: string[] }> = [];

  async sendPush(notice: NoticeDoc, topics: string[]): Promise<FcmResponse> {
    this.pushes.push({ notice, topics });
    if (this.error) throw this.error;
    return this.response;
  }
}
