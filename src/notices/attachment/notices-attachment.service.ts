import { Injectable } from "@nestjs/common";
import type { Response } from "express";
import { AppError } from "../../http/app.error";
import { parseAllowedUrl } from "../../infra/outbound-guard";
import { UPSTREAM_USER_AGENT } from "./notices-attachment.constants";
import { NoticesAttachmentClient } from "./notices-attachment.client";
import type { AttachmentRequest } from "./notices-attachment.types";

@Injectable()
export class NoticesAttachmentService {
  constructor(private readonly client: NoticesAttachmentClient) {}

  // WHY: a referer only on an allowed host: clients send the notice's sourceUrl, and anything else is refused
  // before any outbound request (security fix).
  async sendAttachment({ url, referer, mode, name }: AttachmentRequest, res: Response): Promise<void> {
    this.assertAllowed(url, referer);
    const headers: Record<string, string> = { "User-Agent": UPSTREAM_USER_AGENT };
    if (referer) await this.primeSession(headers, referer, { res, fresh: false });
    const upstream = await this.client.fetchAttachment(url, headers);
    const contentType = (upstream.headers["content-type"] as string | undefined) || "";
    if (!referer || !contentType.includes("text/html")) return this.client.sendAttachment(upstream, res, { url, name, mode });
    // WHY: an HTML page where a file was due is the board's login page: the session expired, so retry once.
    upstream.data.destroy();
    await this.primeSession(headers, referer, { res, fresh: true });
    return this.client.sendAttachment(await this.client.fetchAttachment(url, headers), res, { url, name, mode });
  }

  private assertAllowed(url: string | undefined, referer: string | undefined): asserts url is string {
    if (!url) throw new AppError("INVALID_PARAMS", "url is required", 400);
    if (!URL.canParse(url)) throw new AppError("INVALID_PARAMS", "malformed url", 400);
    if (!parseAllowedUrl(url)) throw new AppError("FORBIDDEN", "host not allowed", 403);
    if (referer && !parseAllowedUrl(referer)) throw new AppError("INVALID_PARAMS", "referer not allowed", 400);
  }

  private async primeSession(headers: Record<string, string>, referer: string, { res, fresh }: { res: Response; fresh: boolean }): Promise<void> {
    if (!fresh) headers.Referer = referer;
    try {
      const sessionId = await this.client.fetchSessionId(referer, { fresh });
      if (sessionId) headers.Cookie = `PHPSESSID=${sessionId}`;
    } catch (err: unknown) {
      if (fresh) res.req.log.warn({ event: "notices.attachment.session_retry_failed", err, referer }, "gnuboard session retry fetch failed");
      else res.req.log.warn({ event: "notices.attachment.session_fetch_failed", err, referer }, "gnuboard session fetch failed");
    }
  }
}
