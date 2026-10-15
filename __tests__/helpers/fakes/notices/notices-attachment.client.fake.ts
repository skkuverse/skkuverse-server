/**
 * NoticesAttachmentClient with scripted answers: `sessionIds` hands out one PHPSESSID per session fetch (an
 * Error rejects it), `upstreams` one upstream per attachment fetch, in order, already translated as the real
 * client translates axios's answer (notices-attachment.client.spec.ts covers that). Every call is recorded.
 */
import type { NoticesAttachmentClient } from "../../../../src/notices/attachment/notices-attachment.client";
import type { AttachmentUpstream } from "../../../../src/notices/attachment/notices-attachment.types";
import type { PublicOf } from "../public-of";

export class FakeNoticesAttachmentClient implements PublicOf<NoticesAttachmentClient> {
  sessionIds: Array<string | null | Error> = [];
  upstreams: AttachmentUpstream[] = [];
  sessionFetches: Array<{ refererUrl: string; fresh: boolean }> = [];
  attachmentFetches: Array<{ url: string; headers: Record<string, string> }> = [];

  onModuleDestroy(): void {}

  async fetchSessionId(refererUrl: string, { fresh = false } = {}): Promise<string | null> {
    this.sessionFetches.push({ refererUrl, fresh });
    const next = this.sessionIds.shift() ?? null;
    if (next instanceof Error) throw next;
    return next;
  }

  async fetchAttachment(url: string, headers: Record<string, string>): Promise<AttachmentUpstream> {
    this.attachmentFetches.push({ url, headers: { ...headers } });
    const next = this.upstreams.shift();
    if (!next) throw new Error("no upstream scripted");
    return next;
  }
}
