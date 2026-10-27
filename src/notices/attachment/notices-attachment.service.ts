import { Injectable } from "@nestjs/common";
import { AppError } from "../../http/app.error";
import { OutboundPolicy } from "../../perimeter/perimeter.ports";
import { MAX_ATTACHMENT_BYTES, UPSTREAM_USER_AGENT } from "./notices-attachment.constants";
import { NoticesAttachmentClient } from "./notices-attachment.client";
import { toAttachmentFilename, toAttachmentHeaders } from "./notices-attachment.rules";
import type { AttachmentRequest } from "./notices-attachment.schema";
import type { AttachmentDownload, AttachmentLog, AttachmentUpstream } from "./notices-attachment.types";

@Injectable()
export class NoticesAttachmentService {
  constructor(
    private readonly client: NoticesAttachmentClient,
    private readonly outbound: OutboundPolicy,
  ) {}

  // WHY: a referer only where the outbound policy allows a fetch: clients send the notice's sourceUrl, and anything
  // else is refused before any outbound request.
  async fetchDownload({ url, referer, mode, name }: AttachmentRequest, log: AttachmentLog): Promise<AttachmentDownload> {
    if (!this.outbound.allows("notice-attachment", url)) throw new AppError("FORBIDDEN", "host not allowed", 403);
    if (referer && !this.outbound.allows("notice-attachment", referer)) throw new AppError("INVALID_PARAMS", "referer not allowed", 400);
    const headers: Record<string, string> = { "User-Agent": UPSTREAM_USER_AGENT };
    if (referer) await this.primeSession(headers, referer, { log, fresh: false });
    const upstream = await this.client.fetchAttachment(url, headers);
    if (!referer || !(upstream.contentType ?? "").includes("text/html")) return this.toDownload(upstream, url, { mode, name });
    // WHY: an HTML page where a file was due is the board's login page: the session expired, so retry once.
    upstream.body.destroy();
    await this.primeSession(headers, referer, { log, fresh: true });
    return this.toDownload(await this.client.fetchAttachment(url, headers), url, { mode, name });
  }

  // WHY: a declared length over the cap is refused before any header is written; the transfer enforces it again.
  private toDownload(upstream: AttachmentUpstream, url: string, { mode, name }: Pick<AttachmentRequest, "mode" | "name">): AttachmentDownload {
    if (upstream.contentLength !== undefined && upstream.contentLength > MAX_ATTACHMENT_BYTES) {
      upstream.body.destroy();
      throw new AppError("UPSTREAM_TOO_LARGE", "attachment too large", 502);
    }
    return { headers: toAttachmentHeaders(mode, toAttachmentFilename(url, name), upstream.contentType), body: upstream.body };
  }

  private async primeSession(headers: Record<string, string>, referer: string, { log, fresh }: { log: AttachmentLog; fresh: boolean }): Promise<void> {
    if (!fresh) headers.Referer = referer;
    try {
      const sessionId = await this.client.fetchSessionId(referer, { fresh });
      if (sessionId) headers.Cookie = `PHPSESSID=${sessionId}`;
    } catch (err: unknown) {
      if (fresh) log.warn({ event: "notices.attachment.session_retry_failed", err, referer }, "gnuboard session retry fetch failed");
      else log.warn({ event: "notices.attachment.session_fetch_failed", err, referer }, "gnuboard session fetch failed");
    }
  }
}
