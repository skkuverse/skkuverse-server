/**
 * (A perimeter detail is left out of the public history.)
 */
jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { FakeMiniappsRepository } from "../../../__tests__/helpers/fakes/miniapps/miniapps.repository.fake";
import { FakeMiniAppPushAuthorizer } from "../../../__tests__/helpers/fakes/perimeter/mini-app-push-authorizer.fake";
import { FakeMiniAppPushQuota } from "../../../__tests__/helpers/fakes/perimeter/mini-app-push-quota.fake";
import { FakePushContentPolicy } from "../../../__tests__/helpers/fakes/perimeter/push-content-policy.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { fixtureRegistry } from "../../../__tests__/helpers/miniapps/registry-fixture";
import { perimeterRequest } from "../../../__tests__/helpers/perimeter/perimeter-deps";
import type { AppError } from "../../http/app.error";
import type { Clock } from "../../infra/clock";
import type { MiniAppPushAuthorizer, MiniAppPushQuota, PerimeterRequest, PushAuthorization, PushContentPolicy } from "../../perimeter/perimeter.ports";
import type { MiniappsRepository } from "../miniapps.repository";
import { MiniappsService } from "../miniapps.service";
import { MiniappsSenderService } from "./miniapps-sender.service";

const clock: Clock = { now: () => new Date("2026-10-20T03:00:00.000Z") };
const BODY = Buffer.from('{"title_ko":"t","body_ko":"b"}');
const SEND: PerimeterRequest = perimeterRequest({ method: "POST", target: "/internal/miniapps/hssc/notifications", headers: { "Content-Type": "application/json" } });

let authorizer: FakeMiniAppPushAuthorizer;
let senders: MiniappsSenderService;

beforeEach(() => {
  authorizer = new FakeMiniAppPushAuthorizer();
  const miniApps = new MiniappsService(asReal<MiniappsRepository>(FakeMiniappsRepository.seededWith(fixtureRegistry())), clock);
  senders = new MiniappsSenderService(
    miniApps,
    asReal<MiniAppPushAuthorizer>(authorizer),
    asReal<MiniAppPushQuota>(new FakeMiniAppPushQuota()),
    asReal<PushContentPolicy>(new FakePushContentPolicy()),
  );
});

const refusalOf = (pending: Promise<unknown>): Promise<[number, string] | "allowed"> =>
  pending.then(
    () => "allowed" as const,
    (err: AppError) => [err.httpStatus, err.code],
  );

describe("MiniappsSenderService.authorize", () => {
  it("answers an allowed, registered sender with the registry snapshot it was checked against", async () => {
    // Act
    const sender = await senders.authorize({ senderId: "hssc", scope: "push.send", request: SEND, rawBody: BODY });

    // Assert
    expect(sender.miniAppId).toBe("hssc");
    expect(sender.registry.isKnownMiniAppTarget("hssc")).toBe(true);
  });

  it("asks the authorizer with the sender, the scope, the request, the raw body and the registry's credentials", async () => {
    // Act
    await senders.authorize({ senderId: "hssc", scope: "push.history", request: SEND, rawBody: BODY });
    await refusalOf(senders.authorize({ senderId: "no-such-app", scope: "push.send", request: SEND, rawBody: undefined }));

    // Assert
    expect(authorizer.calls).toEqual([
      { senderId: "hssc", scope: "push.history", request: SEND, rawBody: BODY, credentials: { status: "pending", scopes: [], signingKeys: [] } },
      { senderId: "no-such-app", scope: "push.send", request: SEND, rawBody: undefined, credentials: null },
    ]);
  });

  it.each<[string, string, PushAuthorization, [number, string] | "allowed"]>([
    ["an unauthenticated call for an unknown sender", "no-such-app", { allowed: false, reason: "unauthenticated" }, [401, "UNAUTHORIZED"]],
    ["a forbidden call for an unknown sender", "no-such-app", { allowed: false, reason: "forbidden" }, [403, "FORBIDDEN"]],
    ["an allowed call for an unknown sender", "no-such-app", { allowed: true, keyId: null }, [404, "MINIAPP_NOT_FOUND"]],
    ["an unauthenticated call for a registered sender", "hssc", { allowed: false, reason: "unauthenticated" }, [401, "UNAUTHORIZED"]],
    ["a forbidden call for a registered sender", "hssc", { allowed: false, reason: "forbidden" }, [403, "FORBIDDEN"]],
    ["an allowed call for a registered sender", "hssc", { allowed: true, keyId: null }, "allowed"],
  ])("answers %s with %p", async (_label, senderId, authorization, answer) => {
    // Arrange
    authorizer.authorization = authorization;

    // Act & Assert
    expect(await refusalOf(senders.authorize({ senderId, scope: "push.send", request: SEND, rawBody: BODY }))).toEqual(answer);
  });

  it.each<[string, PushAuthorization, string | null]>([
    ["a call signed by a key", { allowed: true, keyId: "key-1" }, "key-1"],
    ["a call signed by no key", { allowed: true, keyId: null }, null],
  ])("answers %s with the key that signed it", async (_label, authorization, keyId) => {
    // Arrange
    authorizer.authorization = authorization;

    // Act
    const sender = await senders.authorize({ senderId: "hssc", scope: "push.send", request: SEND, rawBody: BODY });

    // Assert
    expect(sender.keyId).toBe(keyId);
  });

  it("refuses a decision signed by a key over a body sent with a Content-Encoding, as unauthenticated", async () => {
    // Arrange
    authorizer.authorization = { allowed: true, keyId: "key-1" };
    const gzipped = perimeterRequest({ method: "POST", target: "/internal/miniapps/hssc/notifications", headers: { "Content-Encoding": "gzip" } });

    // Act & Assert
    expect(await refusalOf(senders.authorize({ senderId: "hssc", scope: "push.send", request: gzipped, rawBody: BODY }))).toEqual([401, "UNAUTHORIZED"]);
  });
});

// WHY: the internal routes' binding, after INTERNAL_AUTHORIZER took the token under miniapps.push; until deploy 2.
describe("MiniappsSenderService.authorizeTrusted", () => {
  it("answers a registered sender with no key and the registry snapshot, never asking MINIAPP_PUSH_AUTHORIZER", async () => {
    // Arrange
    authorizer.authorization = { allowed: false, reason: "unauthenticated" };

    // Act
    const sender = await senders.authorizeTrusted("hssc");

    // Assert
    expect([sender.miniAppId, sender.keyId, sender.registry.isKnownMiniAppTarget("hssc")]).toEqual(["hssc", null, true]);
    expect(authorizer.calls).toEqual([]);
  });

  it("answers an id the registry does not hold with 404", async () => {
    // Act & Assert
    expect(await refusalOf(senders.authorizeTrusted("no-such-app"))).toEqual([404, "MINIAPP_NOT_FOUND"]);
  });
});
