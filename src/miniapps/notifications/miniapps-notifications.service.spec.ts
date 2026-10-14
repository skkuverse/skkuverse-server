/**
 * MiniappsNotificationsService — the feed write and the delivery are ONE
 * operation, and the interesting cases are the ones where that pairing is under
 * stress.
 *
 * skkuverse-app ADR 0002's Revisited section permits this feed only because it
 * is broadcast-only, and its added consequence is that the two writes have to
 * agree. So the load-bearing test here is not "a send works" — it is that a
 * FAILED delivery still leaves the feed entry, with `delivery: null` recording
 * what actually happened. Deleting it there would be the same drift in the other
 * direction: devices that did receive the push, with nothing to recover from.
 *
 * Runs over the repository and client fakes, and the sender service over the
 * PUSH_CONTENT_POLICY and MINIAPP_PUSH_QUOTA fakes; the spies on
 * them keep each call the behavior turns on visible (one insert, one send per
 * notification). Which drafts the production policy refuses is tested beside
 * that implementation (ADR 0023, D7).
 */
jest.mock("../../infra/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

import { FakeMiniappsNotificationsClient } from "../../../__tests__/helpers/fakes/miniapps/miniapps-notifications.client.fake";
import { FakeMiniappsNotificationsRepository } from "../../../__tests__/helpers/fakes/miniapps/miniapps-notifications.repository.fake";
import { FakeMiniappsRepository } from "../../../__tests__/helpers/fakes/miniapps/miniapps.repository.fake";
import { FakeMiniAppPushAuthorizer } from "../../../__tests__/helpers/fakes/perimeter/mini-app-push-authorizer.fake";
import { FakeMiniAppPushQuota } from "../../../__tests__/helpers/fakes/perimeter/mini-app-push-quota.fake";
import { FakePushContentPolicy } from "../../../__tests__/helpers/fakes/perimeter/push-content-policy.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { fixtureRegistry, fixtureRegistrySnapshot } from "../../../__tests__/helpers/miniapps/registry-fixture";
import type { Clock } from "../../infra/clock";
import { GAME_ID_BY_FIRST_PARTY_ORIGIN } from "../../infra/origins";
import type { MiniAppPushAuthorizer, MiniAppPushQuota, PushContentPolicy } from "../../perimeter/perimeter.ports";
import type { MiniappsRepository } from "../miniapps.repository";
import { MiniappsService } from "../miniapps.service";
import { MiniappsSenderService } from "../sender/miniapps-sender.service";
import type { MiniappsNotificationsClient } from "./miniapps-notifications.client";
import { FEED_CACHE_TTL_MS } from "../miniapps.constants";
import type { MiniappsNotificationsRepository } from "./miniapps-notifications.repository";
import { MiniappsNotificationsService } from "./miniapps-notifications.service";
import type { PushSender } from "../sender/miniapps-sender.types";
import type { AppError } from "../../http/app.error";
import logger from "../../infra/logger";

const asMock = (spy: jest.SpyInstance): jest.Mock => spy as unknown as jest.Mock;

// WHY: one quota both senders share, reset per test, so a test reads every take the service made.
const quota = new FakeMiniAppPushQuota();
const ESKARA: PushSender = { miniAppId: "eskara-2026", keyId: null, registry: fixtureRegistrySnapshot() };
const HSSC: PushSender = { miniAppId: "hssc", keyId: null, registry: fixtureRegistrySnapshot() };

const fixedClock: Clock = { now: () => new Date("2026-10-14T03:00:00.000Z") };

let repository: FakeMiniappsNotificationsRepository;
let client: FakeMiniappsNotificationsClient;
let contentPolicy: FakePushContentPolicy;
let claimSentNotification: jest.Mock;
let recordDelivery: jest.Mock;
let recordDeliveryFailure: jest.Mock;
let listSentNotifications: jest.Mock;
let sendPush: jest.Mock;

// Fresh per test: the feed is cached per instance, so a shared instance would
// carry one test's rows into the next.
let service: MiniappsNotificationsService;
const validDraft = { title_ko: "우천 안내", body_ko: "공연이 30분 지연됩니다." };

beforeEach(() => {
  jest.clearAllMocks();
  repository = new FakeMiniappsNotificationsRepository();
  client = new FakeMiniappsNotificationsClient();
  contentPolicy = new FakePushContentPolicy();
  quota.decision = { allowed: true };
  quota.senders.length = 0;
  const miniApps = new MiniappsService(asReal<MiniappsRepository>(FakeMiniappsRepository.seededWith(fixtureRegistry())), fixedClock);
  const senders = new MiniappsSenderService(
    miniApps,
    asReal<MiniAppPushAuthorizer>(new FakeMiniAppPushAuthorizer()),
    asReal<MiniAppPushQuota>(quota),
    asReal<PushContentPolicy>(contentPolicy),
  );
  service = new MiniappsNotificationsService(asReal<MiniappsNotificationsRepository>(repository), asReal<MiniappsNotificationsClient>(client), fixedClock, senders);
  claimSentNotification = asMock(jest.spyOn(repository, "claimSentNotification"));
  recordDelivery = asMock(jest.spyOn(repository, "recordDelivery"));
  recordDeliveryFailure = asMock(jest.spyOn(repository, "recordDeliveryFailure"));
  listSentNotifications = asMock(jest.spyOn(repository, "listSentNotifications"));
  sendPush = asMock(jest.spyOn(client, "sendPush"));
  sendPush.mockResolvedValue({ sent: 12, failed: 1, cleanedUp: 1 });
});

describe("MiniappsNotificationsService.send — the feed entry and the delivery", () => {
  it("writes the feed entry BEFORE calling the function, so the id it passes exists", async () => {
    // Arrange
    const result = await service.send(ESKARA, validDraft, "send-101");

    // Act & Assert
    expect(claimSentNotification).toHaveBeenCalledTimes(1);
    const written = claimSentNotification.mock.calls[0][0];
    const handedOver = sendPush.mock.calls[0][0];
    expect(handedOver._id).toBe(written._id);
    expect("notificationId" in result ? result.notificationId : null).toBe(written._id);
  });

  it("records what the function reported", async () => {
    // Arrange
    const result = await service.send(ESKARA, validDraft, "send-102");

    // Act & Assert
    expect(recordDelivery).toHaveBeenCalledWith(expect.any(String), {
      sent: 12,
      failed: 1,
      cleanedUp: 1,
    });
    expect("delivery" in result ? result.delivery : null).toEqual({
      sent: 12,
      failed: 1,
      cleanedUp: 1,
    });
  });

  it("KEEPS the feed entry when delivery fails, with delivery: null", async () => {
    // Arrange
    sendPush.mockRejectedValue(new Error("sendNotification 500: boom"));

    const result = await service.send(ESKARA, validDraft, "send-103");

    // Act & Assert
    expect(claimSentNotification).toHaveBeenCalledTimes(1);
    expect("delivery" in result ? result.delivery : undefined).toBeNull();
    expect("error" in result ? result.error : "").toContain("boom");
    // The entry stays. Nothing deletes it, and no delivery is recorded over it.
    expect(recordDelivery).not.toHaveBeenCalled();
  });

  it("says outcome: delivered on success", async () => {
    // Arrange
    const result = await service.send(ESKARA, validDraft, "send-104");

    // Act & Assert
    expect("outcome" in result ? result.outcome : null).toBe("delivered");
    expect(recordDeliveryFailure).not.toHaveBeenCalled();
  });

  // The outcome decides whether an operator may retry. A wrong "not_sent"
  // makes every subscriber get the announcement twice.
  describe("classifying a failed call — may the operator retry?", () => {
    const withStatus = (status: number) =>
      Object.assign(new Error(`sendNotification ${status}: x`), { status });
    const abort = () => Object.assign(new Error("This operation was aborted"), { name: "AbortError" });

    it.each([
      ["a 400 (payload refused before any send)", withStatus(400), "not_sent"],
      ["a 401 (key refused before any send)", withStatus(401), "not_sent"],
      ["a 429 (the platform had no instance; the function never ran)", withStatus(429), "not_sent"],
      ["a 408 (not on the allowlist — fails safe)", withStatus(408), "unknown"],
      ["a 500 (the function may have failed mid-batch)", withStatus(500), "unknown"],
      ["a 503", withStatus(503), "unknown"],
      ["a timeout (the function keeps sending after we stop waiting)", abort(), "unknown"],
      ["a network error (the request may have arrived)", new TypeError("fetch failed"), "unknown"],
    ])("%s → %s", async (_label, err, outcome) => {
      // Arrange
      sendPush.mockRejectedValue(err);
      const result = await service.send(ESKARA, validDraft, "send-105");

      // Act & Assert
      expect("outcome" in result ? result.outcome : null).toBe(outcome);
      expect("delivery" in result ? result.delivery : undefined).toBeNull();
      // Stored on the row, so the console's history says the same after a reload.
      const written = claimSentNotification.mock.calls[0][0];
      expect(recordDeliveryFailure).toHaveBeenCalledWith(written._id, {
        outcome,
        error: expect.any(String),
      });
      expect(recordDelivery).not.toHaveBeenCalled();
    });

    it("still answers when recording the failure fails too", async () => {
      // Arrange
      sendPush.mockRejectedValue(abort());
      recordDeliveryFailure.mockRejectedValue(new Error("atlas down"));
      const result = await service.send(ESKARA, validDraft, "send-106");

      // Act & Assert
      expect("outcome" in result ? result.outcome : null).toBe("unknown");
    });
  });

  it("reports DELIVERED when the multicast succeeded but recording it failed", async () => {
    // Arrange
    // 4200 devices already have the banner. Calling this "delivery failed" is
    // the lie that gets ops to resend, and everyone gets it twice.
    sendPush.mockResolvedValue({ sent: 4200, failed: 3, cleanedUp: 0 });
    recordDelivery.mockRejectedValue(new Error("replica set step-down"));

    const result = await service.send(ESKARA, validDraft, "send-107");

    // Act & Assert
    expect("delivery" in result ? result.delivery : null).toEqual({
      sent: 4200,
      failed: 3,
      cleanedUp: 0,
    });
    expect("error" in result ? result.error : undefined).toBeUndefined();
  });

  it("stores the Korean text and a null English pair when none is given", async () => {
    // Arrange
    await service.send(ESKARA, validDraft, "send-108");
    const written = claimSentNotification.mock.calls[0][0];

    // Act & Assert
    expect(written.title_ko).toBe("우천 안내");
    expect(written.title_en).toBeNull();
    expect(written.body_en).toBeNull();
    expect(written.delivery).toBeNull();
  });
});

// SEE: docs/decisions/0020-miniapp-push-link-policy.md ("D5. A repeated send is answered from the stored row")
describe("MiniappsNotificationsService.send — an Idempotency-Key repeat answers the stored outcome", () => {
  const abort = () => Object.assign(new Error("This operation was aborted"), { name: "AbortError" });

  it("answers a repeat after a delivery with the first outcome, sending once", async () => {
    // Arrange
    const first = await service.send(ESKARA, validDraft, "retry-1");

    // Act
    const repeat = await service.send(ESKARA, validDraft, "retry-1");

    // Assert
    expect(repeat).toEqual(first);
    expect(repeat).toEqual({ notificationId: expect.any(String), delivery: { sent: 12, failed: 1, cleanedUp: 1 }, outcome: "delivered" });
    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it("answers a repeat after a timeout with the stored unknown outcome, sending once", async () => {
    // Arrange
    sendPush.mockRejectedValueOnce(abort());
    const first = await service.send(ESKARA, validDraft, "retry-2");

    // Act
    const repeat = await service.send(ESKARA, validDraft, "retry-2");

    // Assert
    expect(repeat).toEqual({ notificationId: "notificationId" in first ? first.notificationId : "", delivery: null, outcome: "unknown", error: "This operation was aborted" });
    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it("answers a repeat after a refusal with the stored not_sent outcome, sending once", async () => {
    // Arrange
    sendPush.mockRejectedValueOnce(Object.assign(new Error("sendNotification 400: bad"), { status: 400 }));
    const first = await service.send(ESKARA, validDraft, "retry-3");

    // Act
    const repeat = await service.send(ESKARA, validDraft, "retry-3");

    // Assert
    expect(repeat).toEqual(first);
    expect(repeat).toEqual(expect.objectContaining({ outcome: "not_sent", delivery: null }));
    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it("answers unknown for a repeat whose first send has no recorded outcome yet, sending nothing", async () => {
    // Arrange
    repository.notifications.push({
      _id: "in-flight",
      miniAppId: "eskara-2026",
      title_ko: validDraft.title_ko,
      body_ko: validDraft.body_ko,
      title_en: null,
      body_en: null,
      sentAt: new Date("2026-10-14T02:59:50.000Z"),
      delivery: null,
      idempotencyKey: "retry-4",
    });

    // Act
    const repeat = await service.send(ESKARA, validDraft, "retry-4");

    // Assert
    expect(repeat).toEqual({
      notificationId: "in-flight",
      delivery: null,
      outcome: "unknown",
      error: "the first send with this Idempotency-Key has no recorded outcome yet; check the Cloud Function log for this notificationId",
    });
    expect(sendPush).not.toHaveBeenCalled();
    expect(claimSentNotification).not.toHaveBeenCalled();
  });

  it("sends once for two concurrent sends with the same key, both answering the one row", async () => {
    // Act
    const [a, b] = await Promise.all([
      service.send(ESKARA, validDraft, "retry-5"),
      service.send(ESKARA, validDraft, "retry-5"),
    ]);

    // Assert
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(repository.notifications).toHaveLength(1);
    expect("notificationId" in a ? a.notificationId : "a").toBe("notificationId" in b ? b.notificationId : "b");
  });

  it("answers a sequential repeat from the stored row while the unique index is not built yet", async () => {
    // Arrange
    // An api replica ships before the poller that builds the index (ADR 0012, D3).
    repository.keyIndexMissing = true;
    const first = await service.send(ESKARA, validDraft, "retry-8");

    // Act
    const repeat = await service.send(ESKARA, validDraft, "retry-8");

    // Assert
    expect(repeat).toEqual(first);
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(repository.notifications).toHaveLength(1);
  });

  it.each([
    ["a different title", { ...validDraft, title_ko: "공연 취소" }],
    ["a different body", { ...validDraft, body_ko: "공연이 취소됩니다." }],
    ["an English text the first lacked", { ...validDraft, title_en: "Rain", body_en: "Delayed" }],
    ["an action the first lacked", { ...validDraft, actionType: "route", actionValue: "/campus" }],
  ])("refuses a repeat with %s as IDEMPOTENCY_KEY_REUSED, writing and sending nothing more", async (_case, changed) => {
    // Arrange
    await service.send(ESKARA, validDraft, "retry-9");

    // Act
    const repeating = service.send(ESKARA, changed, "retry-9");

    // Assert
    await expect(repeating).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
      httpStatus: 422,
      message: "Idempotency-Key was already used for a different notification; send this one with a new key",
    });
    expect(repository.notifications).toHaveLength(1);
    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it("refuses a repeat whose actionValue differs, the action type the same", async () => {
    // Arrange
    await service.send(ESKARA, { ...validDraft, actionType: "route", actionValue: "/campus" }, "retry-10");

    // Act
    const repeating = service.send(ESKARA, { ...validDraft, actionType: "route", actionValue: "/transit" }, "retry-10");

    // Assert
    await expect(repeating).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED", httpStatus: 422 });
    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it("replays a repeat whose draft differs only in surrounding whitespace, which the policy trims", async () => {
    // Arrange
    contentPolicy.result = { content: { title_ko: validDraft.title_ko, body_ko: validDraft.body_ko, title_en: null, body_en: null } };
    const first = await service.send(ESKARA, validDraft, "retry-11");

    // Act
    const repeat = await service.send(ESKARA, { title_ko: ` ${validDraft.title_ko} `, body_ko: validDraft.body_ko }, "retry-11");

    // Assert
    expect(repeat).toEqual(first);
    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it("refuses the loser of a race whose body differs, sending once", async () => {
    // Act
    const results = await Promise.allSettled([
      service.send(ESKARA, validDraft, "retry-12"),
      service.send(ESKARA, { ...validDraft, title_ko: "공연 취소" }, "retry-12"),
    ]);

    // Assert
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(results[1]).toMatchObject({ reason: { code: "IDEMPOTENCY_KEY_REUSED", httpStatus: 422 } });
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(repository.notifications).toHaveLength(1);
  });

  it("sends again for the same key under another mini app", async () => {
    // Arrange
    await service.send(ESKARA, validDraft, "retry-6");

    // Act
    await service.send(HSSC, validDraft, "retry-6");

    // Assert
    expect(sendPush).toHaveBeenCalledTimes(2);
    expect(repository.notifications).toHaveLength(2);
  });

  it("stores the key on the row it claims", async () => {
    // Act
    await service.send(ESKARA, validDraft, "retry-7");

    // Assert
    expect(repository.notifications.map((row) => row.idempotencyKey)).toEqual(["retry-7"]);
  });

  it.each(["", "k".repeat(129), "retry 1", "retry/1"])("refuses the key %j with INVALID_IDEMPOTENCY_KEY, writing nothing", async (key) => {
    // Act
    const sending = service.send(ESKARA, validDraft, key);

    // Assert
    await expect(sending).rejects.toMatchObject({
      code: "INVALID_IDEMPOTENCY_KEY",
      httpStatus: 400,
      message: "Idempotency-Key must be 1-128 characters of A-Z, a-z, 0-9, _ and -",
    });
    expect(repository.notifications).toEqual([]);
    expect(sendPush).not.toHaveBeenCalled();
  });
});

/**
 * A push's map target: `chipId` and `placeId` keep the route and tell a current app which chip or place to
 * open the map with (skkuverse-app ADR 0022, decision 7). They are stored on the row, handed to the Cloud
 * Function, and part of what a repeat must match; a malformed one is refused with the draft's other problems.
 */
describe("send — the map target keys", () => {
  const targeted = { ...validDraft, actionType: "route", actionValue: "/campus", chipId: "day1", placeId: "bus_stop:hssc-600th" };

  it("stores chipId and placeId on the feed row and hands them to the Cloud Function", async () => {
    // Act
    const result = await service.send(ESKARA, targeted, "send-109");

    // Assert
    expect(result).toMatchObject({ outcome: "delivered" });
    expect(repository.notifications[0]).toMatchObject({ actionValue: "/campus", chipId: "day1", placeId: "bus_stop:hssc-600th" });
    expect(sendPush.mock.calls[0][0]).toMatchObject({ chipId: "day1", placeId: "bus_stop:hssc-600th" });
  });

  it("refuses a malformed placeId after the draft's own problems, writing nothing", async () => {
    // Arrange
    const malformed = { title_ko: "t", chipId: "day1", placeId: "taxi_stand:12" };
    contentPolicy.result = { problems: ["body_ko is required and must be 1-500 characters"] };

    // Act
    const result = await service.send(ESKARA, malformed, "send-110");

    // Assert
    expect(result).toEqual({
      problems: [
        "body_ko is required and must be 1-500 characters",
        "placeId must be [<kind>:]<id>, kind one of skku_building, event, bus_stop, subway_station and id 1-128 characters of a-z, 0-9 and -",
      ],
    });
    expect(repository.notifications).toEqual([]);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("refuses a repeat whose placeId differs, sending once", async () => {
    // Arrange
    await service.send(ESKARA, targeted, "retry-20");
    const elsewhere = { ...targeted, placeId: "subway_station:hyehwa" };

    // Act
    const repeating = service.send(ESKARA, elsewhere, "retry-20");

    // Assert
    await expect(repeating).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED", httpStatus: 422 });
    expect(sendPush).toHaveBeenCalledTimes(1);
  });
});

describe("send — PUSH_CONTENT_POLICY decides before anything is written", () => {
  it("asks the policy with the sender in the path, the first-party game ids and the registry's target check", async () => {
    // Act
    await service.send(ESKARA, { ...validDraft, actionType: "miniapp", actionValue: "hssc/notice" }, "send-111");

    // Assert
    expect(contentPolicy.calls).toHaveLength(1);
    const { draft, scope } = contentPolicy.calls[0]!;
    expect(draft).toEqual({ ...validDraft, actionType: "miniapp", actionValue: "hssc/notice" });
    expect(scope.senderId).toBe("eskara-2026");
    expect([...scope.gameIds].sort()).toEqual(Object.values(GAME_ID_BY_FIRST_PARTY_ORIGIN).sort());
    expect(["hssc/notice", "not-a-mini-app"].map((value) => scope.isKnownMiniAppTarget(value))).toEqual([true, false]);
  });

  it("answers a refused draft with the policy's problems, writing and sending nothing", async () => {
    // Arrange
    contentPolicy.result = { problems: ["actionValue for route must be one of [/home]"] };

    // Act
    const result = await service.send(ESKARA, { ...validDraft, actionType: "route", actionValue: "//evil.com" }, "send-112");

    // Assert
    expect(result).toEqual({ problems: ["actionValue for route must be one of [/home]"] });
    expect(claimSentNotification).not.toHaveBeenCalled();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("stores and sends the content the policy checked, not the draft as sent", async () => {
    // Arrange
    contentPolicy.result = { content: { title_ko: "제목", body_ko: "본문", title_en: null, body_en: null, actionType: "route", actionValue: "/campus" } };

    // Act
    await service.send(ESKARA, { title_ko: " 제목 ", body_ko: "본문", actionType: "route", actionValue: "/campus" }, "send-113");

    // Assert
    expect(repository.notifications[0]).toMatchObject({ title_ko: "제목", body_ko: "본문", actionType: "route", actionValue: "/campus" });
    expect(sendPush.mock.calls[0][0]).toMatchObject({ title_ko: "제목", actionValue: "/campus" });
  });
});

// SEE: docs/decisions/0023-perimeter-ports.md ("D1. Eight ports, one file"): taken once per send that reaches delivery.
describe("send — MINIAPP_PUSH_QUOTA", () => {
  it("takes the sender's quota once per send that reaches delivery", async () => {
    // Act
    await service.send(ESKARA, validDraft, "send-114");
    await service.send(HSSC, validDraft, "send-115");

    // Assert
    expect(quota.senders).toEqual(["eskara-2026", "hssc"]);
  });

  it("answers a spent quota with its Retry-After, writing and sending nothing", async () => {
    // Arrange
    quota.decision = { allowed: false, retryAfterSeconds: 42 };

    // Act
    const result = await service.send(ESKARA, validDraft, "send-116");

    // Assert
    expect(result).toEqual({ retryAfterSeconds: 42 });
    expect(repository.notifications).toEqual([]);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("spends nothing on a refused draft or an Idempotency-Key repeat", async () => {
    // Arrange
    await service.send(ESKARA, validDraft, "retry-30");
    contentPolicy.result = { problems: ["title_ko is required and must be 1-500 characters"] };
    await service.send(ESKARA, {}, "send-117");
    contentPolicy.result = undefined;

    // Act
    await service.send(ESKARA, validDraft, "retry-30");

    // Assert
    expect(quota.senders).toEqual(["eskara-2026"]);
    expect(sendPush).toHaveBeenCalledTimes(1);
  });
});

describe("MiniappsNotificationsService.feed", () => {
  const doc = {
    _id: "n1",
    miniAppId: "eskara-2026",
    title_ko: "한국어",
    body_ko: "본문",
    title_en: "English",
    body_en: "Body",
    sentAt: new Date("2026-09-01T03:00:00.000Z"),
    delivery: { sent: 1, failed: 0, cleanedUp: 0 },
  };

  it("returns Korean by default", async () => {
    // Arrange
    listSentNotifications.mockResolvedValue([doc]);
    const [entry] = await service.feed("eskara-2026", "ko");

    // Act & Assert
    expect(entry!.title).toBe("한국어");
    expect(entry!.id).toBe("n1");
    expect(entry!.sentAt).toBe("2026-09-01T03:00:00.000Z");
  });

  it("returns English when asked", async () => {
    // Arrange
    listSentNotifications.mockResolvedValue([doc]);
    const [entry] = await service.feed("eskara-2026", "en");

    // Act & Assert
    expect(entry!.title).toBe("English");
  });

  it("falls back to Korean when the English pair is absent", async () => {
    // Arrange
    listSentNotifications.mockResolvedValue([{ ...doc, title_en: null, body_en: null }]);
    const [entry] = await service.feed("eskara-2026", "en");

    // Act & Assert
    expect(entry!.title).toBe("한국어");
  });

  it("falls back to Korean for zh — the payload carries ko/en only", async () => {
    // Arrange
    listSentNotifications.mockResolvedValue([doc]);
    const [entry] = await service.feed("eskara-2026", "zh");

    // Act & Assert
    expect(entry!.title).toBe("한국어");
  });

  it("never leaks the delivery record to the public feed", async () => {
    // Arrange
    listSentNotifications.mockResolvedValue([doc]);
    const [entry] = await service.feed("eskara-2026", "ko");

    // Act & Assert
    expect(entry).not.toHaveProperty("delivery");
    expect(entry).not.toHaveProperty("deliveryError");
    expect(entry).not.toHaveProperty("title_ko");
    expect(entry).not.toHaveProperty("idempotencyKey");
  });
});

describe("feed cache — reads every client makes must not scale Mongo ops", () => {
  const doc = {
    _id: "n1",
    miniAppId: "eskara-2026",
    title_ko: "한국어",
    body_ko: "본문",
    title_en: "English",
    body_en: "Body",
    sentAt: new Date("2026-09-01T03:00:00.000Z"),
    delivery: { sent: 1, failed: 0, cleanedUp: 0 },
  };
  let clock = 1_000_000;

  beforeEach(() => {
    clock = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => clock);
    listSentNotifications.mockResolvedValue([doc]);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("serves repeated reads from one query while fresh", async () => {
    // Arrange
    await Promise.all([
      service.feed("eskara-2026", "ko"),
      service.feed("eskara-2026", "ko"),
      service.feed("eskara-2026", "ko"),
    ]);
    await service.feed("eskara-2026", "ko");

    // Act & Assert
    expect(listSentNotifications).toHaveBeenCalledTimes(1);
  });

  it("shares one query across languages — the language is applied after the read", async () => {
    // Arrange
    const ko = await service.feed("eskara-2026", "ko");
    const en = await service.feed("eskara-2026", "en");

    // Act & Assert
    expect(listSentNotifications).toHaveBeenCalledTimes(1);
    expect(ko[0]!.title).toBe("한국어");
    expect(en[0]!.title).toBe("English");
  });

  it("reloads once the TTL has passed, and serves the NEW rows — never a stale copy", async () => {
    // Arrange
    await service.feed("eskara-2026", "ko");
    clock += FEED_CACHE_TTL_MS + 1;
    listSentNotifications.mockResolvedValue([{ ...doc, _id: "n2" }]);
    const [entry] = await service.feed("eskara-2026", "ko");

    // Act & Assert
    expect(entry!.id).toBe("n2");
    expect(listSentNotifications).toHaveBeenCalledTimes(2);
  });

  it("keeps separate caches per mini app", async () => {
    // Arrange
    await service.feed("eskara-2026", "ko");
    await service.feed("hssc", "ko");

    // Act & Assert
    expect(listSentNotifications).toHaveBeenCalledTimes(2);
    expect(listSentNotifications.mock.calls.map((c) => c[0])).toEqual(["eskara-2026", "hssc"]);
  });

  it("drops this mini app's cache on send, so the sender's replica shows it at once", async () => {
    // Arrange
    await service.feed("eskara-2026", "ko");
    await service.send(ESKARA, validDraft, "send-118");
    await service.feed("eskara-2026", "ko");

    // Act & Assert
    expect(listSentNotifications).toHaveBeenCalledTimes(2);
  });

  it("clears AFTER the insert, so a read racing the insert cannot pin the old feed", async () => {
    // Arrange
    // A feed read that lands while the insert is in flight caches the pre-insert
    // rows. Only a clear that runs after the insert throws that away.
    claimSentNotification.mockImplementation(async () => {
      await service.feed("eskara-2026", "ko");
      return true;
    });
    await service.send(ESKARA, validDraft, "send-119");
    await service.feed("eskara-2026", "ko");

    // Act & Assert
    expect(listSentNotifications).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed read", async () => {
    // Arrange
    listSentNotifications.mockRejectedValueOnce(new Error("atlas down"));

    // Act & Assert
    await expect(service.feed("eskara-2026", "ko")).rejects.toThrow("atlas down");
    const [entry] = await service.feed("eskara-2026", "ko");
    expect(entry!.id).toBe("n1");
    expect(listSentNotifications).toHaveBeenCalledTimes(2);
  });
});

describe("history — the operator's view, delivery included", () => {
  it("returns the delivery record the public feed hides, uncached", async () => {
    // Arrange
    const doc = {
      _id: "n1",
      miniAppId: "eskara-2026",
      title_ko: "우천 안내",
      body_ko: "지연",
      title_en: null,
      body_en: null,
      actionType: "route",
      actionValue: "/miniapp-feed/eskara-2026",
      sentAt: new Date("2026-10-01T09:00:00.000Z"),
      delivery: { sent: 812, failed: 3, cleanedUp: 2 },
    };
    listSentNotifications.mockResolvedValue([doc]);

    const first = await service.history("eskara-2026");
    await service.history("eskara-2026");

    // Act & Assert
    expect(listSentNotifications).toHaveBeenCalledTimes(2);
    expect(first).toEqual([
      {
        id: "n1",
        title_ko: "우천 안내",
        body_ko: "지연",
        title_en: null,
        body_en: null,
        actionType: "route",
        actionValue: "/miniapp-feed/eskara-2026",
        sentAt: "2026-10-01T09:00:00.000Z",
        delivery: { sent: 812, failed: 3, cleanedUp: 2 },
        deliveryError: null,
        idempotencyKey: null,
      },
    ]);
  });

  it("carries the Idempotency-Key a send stored, so the operator can match a key to its row", async () => {
    // Arrange
    await service.send(ESKARA, validDraft, "console-7");

    // Act
    const [entry] = await service.history("eskara-2026");

    // Assert
    expect(entry!.idempotencyKey).toBe("console-7");
  });

  it("carries a failed call's outcome, and null for a row missing the fields", async () => {
    // Arrange
    listSentNotifications.mockResolvedValue([
      {
        _id: "n3",
        miniAppId: "eskara-2026",
        title_ko: "t",
        body_ko: "b",
        sentAt: new Date("2026-10-01T09:00:00.000Z"),
        delivery: null,
        deliveryError: { outcome: "unknown", error: "This operation was aborted" },
      },
      {
        _id: "n4",
        miniAppId: "eskara-2026",
        title_ko: "t",
        body_ko: "b",
        sentAt: new Date("2026-10-01T09:00:00.000Z"),
      },
    ]);
    const [failed, legacy] = await service.history("eskara-2026");

    // Act & Assert
    expect(failed!.deliveryError).toEqual({ outcome: "unknown", error: "This operation was aborted" });
    expect(legacy!.delivery).toBeNull();
    expect(legacy!.deliveryError).toBeNull();
    expect(legacy!.title_en).toBeNull();
  });

  it("reports an undelivered entry as delivery: null", async () => {
    // Arrange
    listSentNotifications.mockResolvedValue([
      {
        _id: "n2",
        miniAppId: "eskara-2026",
        title_ko: "t",
        body_ko: "b",
        title_en: null,
        body_en: null,
        sentAt: new Date("2026-10-01T09:00:00.000Z"),
        delivery: null,
      },
    ]);
    const [entry] = await service.history("eskara-2026");

    // Act & Assert
    expect(entry!.delivery).toBeNull();
  });
});

describe("MiniappsNotificationsService.send — a send signed by a key", () => {
  const SIGNED: PushSender = { ...ESKARA, keyId: "0123456789abcdef" };


  it("sends a signed send with its Idempotency-Key, naming the mini app and the key on every miniapps.notify line", async () => {
    // Act
    const outcome = await service.send(SIGNED, validDraft, "send-1");

    // Assert
    expect(outcome).toMatchObject({ outcome: "delivered" });
    const notifyLines = [...jest.mocked(logger.info).mock.calls, ...jest.mocked(logger.warn).mock.calls]
      .map(([fields]) => fields as unknown as Record<string, unknown>)
      .filter((fields) => String(fields.event).startsWith("miniapps.notify."));
    expect(notifyLines.map((fields) => fields.event)).toEqual(["miniapps.notify.feed_written", "miniapps.notify.sent", "miniapps.notify.request_completed"]);
    expect(notifyLines.every((fields) => fields.miniAppId === "eskara-2026" && fields.keyId === "0123456789abcdef")).toBe(true);
  });

  it("names the key on the replayed line of a repeat with the same Idempotency-Key", async () => {
    // Arrange
    await service.send(SIGNED, validDraft, "send-2");
    jest.mocked(logger.info).mockClear();

    // Act
    await service.send(SIGNED, validDraft, "send-2");

    // Assert
    const replayed = jest.mocked(logger.info).mock.calls.map(([fields]) => fields as unknown as Record<string, unknown>).filter((fields) => fields.event === "miniapps.notify.replayed");
    expect(replayed.map((fields) => [fields.miniAppId, fields.keyId])).toEqual([["eskara-2026", "0123456789abcdef"]]);
  });
});

describe("MiniappsNotificationsService.refuseUnkeyedSignedSend", () => {
  it("refuses a signed send without an Idempotency-Key with 400, logging the mini app and the key", () => {
    // Act
    let refusal: unknown;
    try {
      service.refuseUnkeyedSignedSend({ ...ESKARA, keyId: "0123456789abcdef" });
    } catch (err: unknown) {
      refusal = err;
    }

    // Assert
    expect([(refusal as AppError).httpStatus, (refusal as AppError).code, (refusal as AppError).message]).toEqual([400, "INVALID_IDEMPOTENCY_KEY", "a signed send needs an Idempotency-Key"]);
    expect(jest.mocked(logger.warn).mock.calls.map(([fields]) => fields)).toContainEqual(expect.objectContaining({ event: "miniapps.notify.idempotency_key_invalid", miniAppId: "eskara-2026", keyId: "0123456789abcdef" }));
  });
});
