import { Injectable } from "@nestjs/common";
import { MiniAppPushAuthorizer, MiniAppPushQuota, type PushCall } from "../../perimeter/perimeter.ports";
import { toMiniAppNotFound } from "../miniapps.rules";
import { MiniappsService } from "../miniapps.service";
import { toPushRefusal } from "./miniapps-sender.rules";
import type { PushSender } from "./miniapps-sender.types";

// SEE: docs/explanation/miniapps-architecture.md — every perimeter decision about a push sender, for any push route.
@Injectable()
export class MiniappsSenderService {
  constructor(
    private readonly miniApps: MiniappsService,
    private readonly pushAuthorizer: MiniAppPushAuthorizer,
    private readonly pushQuota: MiniAppPushQuota,
  ) {}

  // WHY: the authorizer answers before an unknown slug's 404, so an unauthenticated caller learns no slug; no
  // registry read, no send: a topic nobody is subscribed to.
  async authorize(received: Omit<PushCall, "credentials">): Promise<PushSender> {
    const { senderId } = received;
    const registry = await this.miniApps.current();
    const credentials = registry.senderCredentialsOf(senderId);
    const call: PushCall = { ...received, credentials };
    const refusal = toPushRefusal(call, await this.pushAuthorizer.authorize(call));
    if (refusal !== null) throw refusal;
    if (credentials === null) throw toMiniAppNotFound(senderId);
    return { miniAppId: senderId, registry, quota: this.pushQuota };
  }
}
