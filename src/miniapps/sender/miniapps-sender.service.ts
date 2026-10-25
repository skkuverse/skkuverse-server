import { Injectable } from "@nestjs/common";
import { GAME_ID_BY_FIRST_PARTY_ORIGIN } from "../../infra/origins";
import {
  MiniAppPushAuthorizer,
  MiniAppPushQuota,
  PushContentPolicy,
  type DraftCheck,
  type NotificationDraft,
  type PushCall,
  type QuotaDecision,
} from "../../perimeter/perimeter.ports";
import { toMiniAppNotFound } from "../miniapps.rules";
import { MiniappsService } from "../miniapps.service";
import { toPushRefusal } from "./miniapps-sender.rules";
import type { PushSender } from "./miniapps-sender.types";

const FIRST_PARTY_GAME_IDS: readonly string[] = Object.values(GAME_ID_BY_FIRST_PARTY_ORIGIN);

// SEE: docs/explanation/miniapps-architecture.md — every perimeter decision about a push sender, for any push route.
@Injectable()
export class MiniappsSenderService {
  constructor(
    private readonly miniApps: MiniappsService,
    private readonly pushAuthorizer: MiniAppPushAuthorizer,
    private readonly pushQuota: MiniAppPushQuota,
    private readonly contentPolicy: PushContentPolicy,
  ) {}

  // WHY: the authorizer answers before an unknown slug's 404, so an unauthenticated caller learns no slug; no
  // registry read, no send: a topic nobody is subscribed to.
  async authorize(received: Omit<PushCall, "credentials">): Promise<PushSender> {
    const { senderId } = received;
    const registry = await this.miniApps.current();
    const credentials = registry.senderCredentialsOf(senderId);
    const call: PushCall = { ...received, credentials };
    const decision = await this.pushAuthorizer.authorize(call);
    const refusal = toPushRefusal(call, decision);
    if (refusal !== null) throw refusal;
    if (credentials === null) throw toMiniAppNotFound(senderId);
    return { miniAppId: senderId, keyId: decision.allowed ? decision.keyId : null, registry };
  }

  // WHY: for the internal routes only, whose INTERNAL_AUTHORIZER guard already took the shared push token; deleted in
  // deploy 2 (docs/decisions/0020-miniapp-push-link-policy.md, D6).
  async authorizeTrusted(senderId: string): Promise<PushSender> {
    const registry = await this.miniApps.current();
    if (registry.senderCredentialsOf(senderId) === null) throw toMiniAppNotFound(senderId);
    return { miniAppId: senderId, keyId: null, registry };
  }

  checkDraft({ miniAppId, registry }: PushSender, draft: NotificationDraft): Promise<DraftCheck> {
    return this.contentPolicy.check(draft, { senderId: miniAppId, gameIds: FIRST_PARTY_GAME_IDS, isKnownMiniAppTarget: (value) => registry.isKnownMiniAppTarget(value) });
  }

  takeQuota({ miniAppId }: PushSender): Promise<QuotaDecision> {
    return this.pushQuota.take(miniAppId);
  }
}
