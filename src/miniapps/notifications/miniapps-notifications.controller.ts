import { Body, Controller, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { AppError } from "../../http/app.error";
import { toPerimeterRequest } from "../../http/perimeter-request.mapper";
import { MiniappsSenderService } from "../sender/miniapps-sender.service";
import { toQuotaRefusal } from "./miniapps-notifications.rules";
import { MiniappsNotificationsService } from "./miniapps-notifications.service";
import type { MiniAppNotificationHistory, SendOutcome } from "./miniapps-notifications.wire";

// SEE: docs/reference/miniapps-api.md ("5.4 Signed calls") — a mini app's backend, signing each call; under the
// general limiter MiniappsModule binds on /miniapps. History is not GET :id/notifications, the public feed.
@Controller("miniapps")
export class MiniappsNotificationsController {
  constructor(
    private readonly senders: MiniappsSenderService,
    private readonly notifications: MiniappsNotificationsService,
  ) {}

  // WHY: set before the read, so a failed read's 500 is never stored either. A GET signs the hash of no bytes, so its
  // raw body is not kept.
  @Get(":id/notifications/history")
  async history(@Param("id") id: string, @Req() req: Request): Promise<MiniAppNotificationHistory> {
    await this.senders.authorize({ senderId: id, scope: "push.history", request: toPerimeterRequest(req), rawBody: undefined });
    req.res?.set("Cache-Control", "no-store");
    return this.notifications.history(id);
  }

  // WHY: 200, not Nest's 201 for a POST: a send repeated under its Idempotency-Key answers the first one's outcome
  // and creates nothing.
  @Post(":id/notifications")
  @HttpCode(200)
  async send(@Param("id") id: string, @Body() body: Record<string, unknown> | undefined, @Req() req: Request): Promise<SendOutcome> {
    const sender = await this.senders.authorize({ senderId: id, scope: "push.send", request: toPerimeterRequest(req), rawBody: req.rawBody });
    const idempotencyKey = req.get("idempotency-key") ?? this.notifications.refuseUnkeyedSignedSend(sender);
    const result = await this.notifications.send(sender, body ?? {}, idempotencyKey);
    if ("problems" in result) throw new AppError("INVALID_PAYLOAD", result.problems.join("; "), 400);
    if ("retryAfterSeconds" in result) {
      req.res?.set("Retry-After", String(result.retryAfterSeconds));
      throw toQuotaRefusal();
    }
    return result;
  }
}
