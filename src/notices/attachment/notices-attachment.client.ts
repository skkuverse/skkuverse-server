import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import axios from "axios";
import { Readable } from "stream";
import { AppError } from "../../http/app.error";
import { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import { OutboundPolicy } from "../../perimeter/perimeter.ports";
import { isRecord } from "../../shared/object.util";
import { SESSION_CACHE_TTL_MS, SESSION_TIMEOUT_MS, UPSTREAM_TIMEOUT_MS, UPSTREAM_USER_AGENT } from "./notices-attachment.constants";
import { toSessionId } from "./notices-attachment.rules";
import type { AttachmentUpstream } from "./notices-attachment.types";

// QUIRK(gnuboard): some department boards refuse a download without the PHPSESSID their board page hands out,
// so the session is primed from the notice's page and kept per host.
@Injectable()
export class NoticesAttachmentClient implements OnModuleDestroy {
  private readonly sessions = new Map<string, { sessionId: string; fetchedAt: number }>();
  private readonly sweep = setInterval(() => this.dropExpiredSessions(), SESSION_CACHE_TTL_MS).unref();

  constructor(
    private readonly clock: Clock,
    private readonly outbound: OutboundPolicy,
  ) {}

  onModuleDestroy(): void {
    clearInterval(this.sweep);
  }

  async fetchSessionId(refererUrl: string, { fresh = false } = {}): Promise<string | null> {
    const host = new URL(refererUrl).hostname;
    const cached = this.sessions.get(host);
    if (fresh) this.sessions.delete(host);
    else if (cached && this.clock.now().getTime() - cached.fetchedAt < SESSION_CACHE_TTL_MS) return cached.sessionId;
    const resp = await axios.get<Readable>(refererUrl, {
      ...this.outbound.requestConfig("notice-attachment"),
      headers: { "User-Agent": UPSTREAM_USER_AGENT },
      timeout: SESSION_TIMEOUT_MS,
      responseType: "stream",
    });
    resp.data.destroy();
    const sessionId = toSessionId((resp.headers["set-cookie"] || []) as string[]);
    if (sessionId) this.sessions.set(host, { sessionId, fetchedAt: this.clock.now().getTime() });
    return sessionId;
  }

  async fetchAttachment(url: string, headers: Record<string, string>): Promise<AttachmentUpstream> {
    try {
      const resp = await axios.get<Readable>(url, { ...this.outbound.requestConfig("notice-attachment"), headers, responseType: "stream", timeout: UPSTREAM_TIMEOUT_MS });
      return this.toUpstream(resp.headers, resp.data);
    } catch (err: unknown) {
      throw this.toUpstreamError(err, url);
    }
  }

  private toUpstream(headers: Record<string, unknown>, body: Readable): AttachmentUpstream {
    const contentType = headers["content-type"];
    const contentLength = Number(headers["content-length"]);
    return {
      contentType: typeof contentType === "string" ? contentType : undefined,
      contentLength: headers["content-length"] !== undefined && Number.isFinite(contentLength) ? contentLength : undefined,
      body,
    };
  }

  private toUpstreamError(err: unknown, url: string): unknown {
    const response = this.releaseErrorBody(err);
    if (this.outbound.isBlocked(err)) return new AppError("FORBIDDEN", "host not allowed", 403);
    const code = isRecord(err) ? err.code : undefined;
    // WHY: the school's server failing is a dead link or an outage there: a 502 and a warning, not a 500 and an Issue.
    if (typeof response?.status === "number" || typeof code === "string") {
      logger.warn({ event: "notices.attachment.upstream_failed", err, host: new URL(url).hostname }, "Attachment upstream failed");
      return new AppError("UPSTREAM_ERROR", "attachment upstream failed", 502);
    }
    return err;
  }

  // QUIRK(axios): a non-2xx rejects with its body stream attached; it is released here, not left to the remote end.
  private releaseErrorBody(err: unknown): Record<string, unknown> | undefined {
    const response = isRecord(err) && isRecord(err.response) ? err.response : undefined;
    if (response?.data instanceof Readable) response.data.destroy();
    return response;
  }

  private dropExpiredSessions(): void {
    const now = this.clock.now().getTime();
    for (const [host, session] of this.sessions) if (now - session.fetchedAt >= SESSION_CACHE_TTL_MS) this.sessions.delete(host);
  }
}
