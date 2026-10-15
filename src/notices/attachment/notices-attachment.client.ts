import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import axios from "axios";
import type { Response } from "express";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { AppError } from "../../http/app.error";
import { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import { guardedRequestConfig, isOutboundBlocked } from "../../infra/outbound-guard";
import { isRecord } from "../../shared/object.util";
import {
  ALLOWED_ATTACHMENT_DOMAINS,
  IDLE_TRANSFER_MS,
  MAX_ATTACHMENT_BYTES,
  MAX_TRANSFER_MS,
  SESSION_CACHE_TTL_MS,
  SESSION_TIMEOUT_MS,
  UPSTREAM_TIMEOUT_MS,
  UPSTREAM_USER_AGENT,
} from "./notices-attachment.constants";
import { toAttachmentFilename, toAttachmentHeaders, toSessionId } from "./notices-attachment.rules";
import type { AttachmentDelivery, AttachmentUpstream } from "./notices-attachment.types";

// QUIRK(gnuboard): some department boards refuse a download without the PHPSESSID their board page hands out,
// so the session is primed from the notice's page and kept per host.
@Injectable()
export class NoticesAttachmentClient implements OnModuleDestroy {
  private readonly sessions = new Map<string, { sessionId: string; fetchedAt: number }>();
  private readonly sweep = setInterval(() => this.dropExpiredSessions(), SESSION_CACHE_TTL_MS).unref();

  constructor(private readonly clock: Clock) {}

  onModuleDestroy(): void {
    clearInterval(this.sweep);
  }

  async fetchSessionId(refererUrl: string, { fresh = false } = {}): Promise<string | null> {
    const host = new URL(refererUrl).hostname;
    const cached = this.sessions.get(host);
    if (fresh) this.sessions.delete(host);
    else if (cached && this.clock.now().getTime() - cached.fetchedAt < SESSION_CACHE_TTL_MS) return cached.sessionId;
    const resp = await axios.get<Readable>(refererUrl, {
      ...guardedRequestConfig(ALLOWED_ATTACHMENT_DOMAINS),
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
      const resp = await axios.get<Readable>(url, { ...guardedRequestConfig(ALLOWED_ATTACHMENT_DOMAINS), headers, responseType: "stream", timeout: UPSTREAM_TIMEOUT_MS });
      return { headers: resp.headers as Record<string, unknown>, data: resp.data };
    } catch (err: unknown) {
      throw this.toUpstreamError(err, url);
    }
  }

  // WHY: headers are already on the wire when a transfer fails, so a failure ends in the destroyed response.
  async sendAttachment(upstream: AttachmentUpstream, res: Response, delivery: AttachmentDelivery): Promise<void> {
    const declaredLength = Number(upstream.headers["content-length"]);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_ATTACHMENT_BYTES) {
      upstream.data.destroy();
      throw new AppError("UPSTREAM_TOO_LARGE", "attachment too large", 502);
    }
    const filename = toAttachmentFilename(delivery.url, delivery.name);
    for (const [header, value] of toAttachmentHeaders(delivery.mode, filename, upstream.headers["content-type"] as string | undefined)) {
      res.setHeader(header, value);
    }
    const abort = new AbortController();
    const overall = setTimeout(() => abort.abort(), MAX_TRANSFER_MS);
    const limiter = this.transferLimiter(abort);
    try {
      await pipeline(upstream.data, limiter.stream, res, { signal: abort.signal });
    } catch {
      return;
    } finally {
      clearTimeout(overall);
      limiter.stop();
    }
  }

  private transferLimiter(abort: AbortController): { stream: Transform; stop: () => void } {
    let idle = setTimeout(() => abort.abort(), IDLE_TRANSFER_MS);
    let received = 0;
    const stream = new Transform({
      transform(chunk: Buffer, _enc, callback) {
        clearTimeout(idle);
        idle = setTimeout(() => abort.abort(), IDLE_TRANSFER_MS);
        received += chunk.length;
        if (received > MAX_ATTACHMENT_BYTES) return callback(new Error("attachment exceeded size cap"));
        callback(null, chunk);
      },
    });
    return { stream, stop: () => clearTimeout(idle) };
  }

  private toUpstreamError(err: unknown, url: string): unknown {
    const response = this.releaseErrorBody(err);
    if (isOutboundBlocked(err)) return new AppError("FORBIDDEN", "host not allowed", 403);
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
