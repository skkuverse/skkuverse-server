/**
 * The signed public push routes (roadmap 2A-3; docs/reference/miniapps-api.md, "5.4 Signed calls"):
 * POST /miniapps/:id/notifications sends, GET /miniapps/:id/notifications/history reads what the mini app sent.
 *
 * Through the production pipeline (buildTestApp), with MINIAPP_PUSH_AUTHORIZER, MINIAPP_PUSH_QUOTA and
 * PUSH_CONTENT_POLICY as scripted fakes: what these cases pin is what the route decides, never the policy. Which
 * signatures, timestamps and senders verify is pinned beside the overlay's implementation
 * (the overlay's authorizer spec), and when a quota refuses beside its own. What it guards:
 *  - the route asks the authorizer with the sender in the path, the scope, the request target as received and the
 *    raw bytes sent, and delivers an allowed send once;
 *  - a refusal answers 401 or 403 before an unknown id's 404, and nothing is written, sent or read;
 *  - a signed send whose body came with a Content-Encoding is 401, whatever the authorizer said;
 *  - a signed send without an Idempotency-Key is 400, nothing written or sent;
 *  - a spent quota is 429 with the quota's Retry-After and the public body, nothing written or sent;
 *  - the policy's problems answer 400 INVALID_PAYLOAD joined by "; ", nothing written or sent;
 *  - a Cloud Function call that rejects still answers 200, `delivery: null` with its error, on the row written;
 *  - a mini app the registry hides from the home grid is still a target the policy is told is known;
 *  - the history is answered uncached (`no-store`), and both routes answer their wire shapes;
 *  - on a replica that has never read the registry, both routes answer 503 MINIAPP_REGISTRY_UNAVAILABLE before the
 *    authorizer is asked, and nothing is written, sent or read.
 * The registry, the sent_notifications rows and the Cloud Function are fakes.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import { gzipSync } from "node:zlib";
import request from "supertest";
import { ConfigModule } from "../../../src/config/config.module";
import { Clock } from "../../../src/infra/clock";
import { MiniappsManifestClient } from "../../../src/miniapps/manifest/miniapps-manifest.client";
import { MiniappsManifestRepository } from "../../../src/miniapps/manifest/miniapps-manifest.repository";
import { MiniappsRepository } from "../../../src/miniapps/miniapps.repository";
import { MiniappsNotificationsClient } from "../../../src/miniapps/notifications/miniapps-notifications.client";
import { MiniappsNotificationsRepository } from "../../../src/miniapps/notifications/miniapps-notifications.repository";
import { miniAppNotificationHistory, sendOutcome } from "../../../src/miniapps/notifications/miniapps-notifications.wire";
import { MiniAppPushAuthorizer, MiniAppPushQuota, PushContentPolicy, RATE_LIMITED_BODY } from "../../../src/perimeter/perimeter.ports";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { FakeMiniappsManifestClient } from "../../helpers/fakes/miniapps/miniapps-manifest.client.fake";
import { FakeMiniappsManifestRepository } from "../../helpers/fakes/miniapps/miniapps-manifest.repository.fake";
import { FakeMiniappsNotificationsClient } from "../../helpers/fakes/miniapps/miniapps-notifications.client.fake";
import { FakeMiniappsNotificationsRepository } from "../../helpers/fakes/miniapps/miniapps-notifications.repository.fake";
import { FakeMiniappsRepository } from "../../helpers/fakes/miniapps/miniapps.repository.fake";
import { FakeMiniAppPushAuthorizer } from "../../helpers/fakes/perimeter/mini-app-push-authorizer.fake";
import { FakeMiniAppPushQuota } from "../../helpers/fakes/perimeter/mini-app-push-quota.fake";
import { FakePushContentPolicy } from "../../helpers/fakes/perimeter/push-content-policy.fake";
import { fixtureRegistry } from "../../helpers/miniapps/registry-fixture";
import { appModulesUnder } from "../../helpers/nest/app-modules";
import { buildTestApp } from "../../helpers/nest/build-test-app";

const CLOCK: Clock = { now: () => new Date("2026-10-14T03:00:00.000Z") };
const ESKARA = "eskara-2026";
const SEND_PATH = `/miniapps/${ESKARA}/notifications`;
const HISTORY_PATH = `/miniapps/${ESKARA}/notifications/history`;
const BODY = JSON.stringify({ title_ko: "우천 안내", body_ko: "공연이 30분 지연됩니다." });
const SIGNED = { allowed: true, keyId: "key-1" } as const;

const repository = new FakeMiniappsNotificationsRepository();
const client = new FakeMiniappsNotificationsClient();
const authorizer = new FakeMiniAppPushAuthorizer();
const quota = new FakeMiniAppPushQuota();
const contentPolicy = new FakePushContentPolicy();
/** The registry's answer in the scope the route handed PUSH_CONTENT_POLICY on its last call. */
const isKnownToPolicy = (value: string): boolean | undefined => contentPolicy.calls.at(-1)?.scope.isKnownMiniAppTarget(value);

let app: NestExpressApplication;
let unreadApp: NestExpressApplication;
let sendPush: jest.SpyInstance;
let claimed: jest.SpyInstance;
let listed: jest.SpyInstance;

function bootPushApp(registry: FakeMiniappsRepository): Promise<NestExpressApplication> {
  return buildTestApp({
    imports: [ConfigModule, SchedulingModule, ...appModulesUnder("src/miniapps/")],
    overrides: [
      { provide: MiniappsRepository, useValue: registry },
      { provide: MiniappsManifestClient, useValue: new FakeMiniappsManifestClient() },
      { provide: MiniappsManifestRepository, useValue: new FakeMiniappsManifestRepository() },
      { provide: MiniappsNotificationsRepository, useValue: repository },
      { provide: MiniappsNotificationsClient, useValue: client },
      { provide: Clock, useValue: CLOCK },
      { provide: MiniAppPushAuthorizer, useValue: authorizer },
      { provide: MiniAppPushQuota, useValue: quota },
      { provide: PushContentPolicy, useValue: contentPolicy },
    ],
    role: "api",
  });
}

beforeAll(async () => {
  const unreachable = new FakeMiniappsRepository();
  unreachable.failWith = new Error("server selection timed out");
  app = await bootPushApp(FakeMiniappsRepository.seededWith(fixtureRegistry()));
  unreadApp = await bootPushApp(unreachable);
});

afterAll(async () => {
  await app.close();
  await unreadApp.close();
});

let sendCount = 0;

beforeEach(() => {
  jest.restoreAllMocks();
  authorizer.authorization = SIGNED;
  authorizer.calls.length = 0;
  quota.decision = { allowed: true };
  quota.senders.length = 0;
  contentPolicy.result = undefined;
  contentPolicy.calls.length = 0;
  sendPush = jest.spyOn(client, "sendPush").mockResolvedValue({ sent: 7, failed: 0, cleanedUp: 0 });
  claimed = jest.spyOn(repository, "claimSentNotification");
  listed = jest.spyOn(repository, "listSentNotifications");
});

function post(path: string, headers: Record<string, string> = {}, body: string | Buffer = BODY): request.Test {
  sendCount += 1;
  // WHY: supertest would serialize a Buffer as JSON; the bytes go out as they are.
  return request(app.getHttpServer())
    .post(path)
    .set({ "Content-Type": "application/json", "Idempotency-Key": `send-${sendCount}`, ...headers })
    .serialize((bytes: string | Buffer) => bytes as unknown as string)
    .send(body);
}

describe("POST /miniapps/:id/notifications", () => {
  it("asks the authorizer with the sender in the path, push.send, the target as received and the bytes sent, and delivers once", async () => {
    // Act
    const res = await post(`/miniapps/${ESKARA}/notifications?via=backend`);

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ outcome: "delivered", delivery: { sent: 7, failed: 0, cleanedUp: 0 } });
    expectWire(sendOutcome, res.body.data);
    expect(authorizer.calls.map(({ senderId, scope, request: asked, rawBody }) => [senderId, scope, asked.method, asked.target, rawBody?.toString("utf8")])).toEqual([
      [ESKARA, "push.send", "POST", `${SEND_PATH}?via=backend`, BODY],
    ]);
    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it.each<[string, { allowed: false; reason: "unauthenticated" | "forbidden" }, number, string]>([
    ["unauthenticated", { allowed: false, reason: "unauthenticated" }, 401, "UNAUTHORIZED"],
    ["forbidden", { allowed: false, reason: "forbidden" }, 403, "FORBIDDEN"],
  ])("answers a send the authorizer finds %s for an unknown id before its 404, nothing written or sent", async (_label, refusal, status, code) => {
    // Arrange
    authorizer.authorization = refusal;

    // Act
    const res = await post("/miniapps/no-such-app/notifications");

    // Assert
    expect([res.status, res.body.error?.code]).toEqual([status, code]);
    expect(claimed).not.toHaveBeenCalled();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("answers an allowed send for an id the registry does not hold with 404", async () => {
    // Act
    const res = await post("/miniapps/no-such-app/notifications");

    // Assert
    expect([res.status, res.body.error?.code]).toEqual([404, "MINIAPP_NOT_FOUND"]);
  });

  it("answers a signed send whose body came with Content-Encoding: gzip with 401, whatever the authorizer said", async () => {
    // Act
    const res = await post(SEND_PATH, { "Content-Encoding": "gzip" }, gzipSync(BODY));

    // Assert
    expect([res.status, res.body.error?.code]).toEqual([401, "UNAUTHORIZED"]);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("answers a signed send without an Idempotency-Key with 400, nothing written or sent", async () => {
    // Act
    const res = await request(app.getHttpServer()).post(SEND_PATH).set("Content-Type", "application/json").send(BODY);

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({ code: "INVALID_IDEMPOTENCY_KEY", message: "a signed send needs an Idempotency-Key" });
    expect(claimed).not.toHaveBeenCalled();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("answers a send the quota refuses with 429, its Retry-After and the public body, nothing written or sent", async () => {
    // Arrange
    quota.decision = { allowed: false, retryAfterSeconds: 1800 };

    // Act
    const res = await post(SEND_PATH);

    // Assert
    expect(res.status).toBe(429);
    expect(res.body).toEqual(RATE_LIMITED_BODY);
    expect(res.headers["retry-after"]).toBe("1800");
    expect(quota.senders).toEqual([ESKARA]);
    expect(claimed).not.toHaveBeenCalled();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("answers a draft the content policy refuses with 400 INVALID_PAYLOAD naming its problems, nothing written or sent", async () => {
    // Arrange
    contentPolicy.result = { problems: ["a", "b"] };
    const rowsBefore = repository.notifications.length;

    // Act
    const res = await post(SEND_PATH);

    // Assert
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "INVALID_PAYLOAD", message: "a; b" } });
    expect(repository.notifications).toHaveLength(rowsBefore);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("still returns 200 when delivery fails — the feed entry was written", async () => {
    // Arrange
    sendPush.mockRejectedValue(new Error("boom"));

    // Act
    const res = await post(SEND_PATH);

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.delivery).toBeNull();
    expect(res.body.data.error).toContain("boom");
    expect(repository.notifications.find((row) => row._id === res.body.data.notificationId)?.deliveryError?.error).toBe("boom");
  });

  it("sends a target naming a mini app the registry hides from the home grid", async () => {
    // Arrange
    const hiddenIds = fixtureRegistry().index.miniApps.filter((entry) => entry.hidden === true).map((entry) => String(entry.id));
    const body = JSON.stringify({ ...JSON.parse(BODY), actionType: "miniapp", actionValue: "inja" });

    // Act
    const res = await post(SEND_PATH, {}, body);

    // Assert
    expect(hiddenIds).toContain("inja");
    expect(res.status).toBe(200);
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(isKnownToPolicy("inja")).toBe(true);
  });
});

describe("GET /miniapps/:id/notifications/history", () => {
  it("answers what the mini app sent, uncached, asking the authorizer under push.history", async () => {
    // Arrange
    await post(SEND_PATH);
    authorizer.calls.length = 0;

    // Act
    const res = await request(app.getHttpServer()).get(`/miniapps/${ESKARA}/notifications/history`);

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.data.map((row: { title_ko: string }) => row.title_ko)).toContain("우천 안내");
    expectWire(miniAppNotificationHistory, res.body.data);
    expect(authorizer.calls.map(({ senderId, scope, request: asked }) => [senderId, scope, asked.method, asked.target])).toEqual([[ESKARA, "push.history", "GET", HISTORY_PATH]]);
  });

  it("answers a history read the authorizer refuses for an unknown id with 401 before its 404, reading nothing", async () => {
    // Arrange
    authorizer.authorization = { allowed: false, reason: "unauthenticated" };

    // Act
    const res = await request(app.getHttpServer()).get("/miniapps/no-such-app/notifications/history");

    // Assert
    expect([res.status, res.body.error?.code]).toEqual([401, "UNAUTHORIZED"]);
    expect(listed).not.toHaveBeenCalled();
  });
});

describe("the signed push routes on a replica that has never read the registry", () => {
  it("answers a send with 503 MINIAPP_REGISTRY_UNAVAILABLE before asking the authorizer, nothing written or sent", async () => {
    // Act
    const res = await request(unreadApp.getHttpServer()).post(SEND_PATH).set({ "Content-Type": "application/json", "Idempotency-Key": "unread-1" }).send(BODY);

    // Assert
    expect([res.status, res.body.error?.code]).toEqual([503, "MINIAPP_REGISTRY_UNAVAILABLE"]);
    expect(authorizer.calls).toEqual([]);
    expect(claimed).not.toHaveBeenCalled();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("answers a history read with 503 MINIAPP_REGISTRY_UNAVAILABLE before asking the authorizer, reading no row", async () => {
    // Act
    const res = await request(unreadApp.getHttpServer()).get(HISTORY_PATH);

    // Assert
    expect([res.status, res.body.error?.code]).toEqual([503, "MINIAPP_REGISTRY_UNAVAILABLE"]);
    expect(authorizer.calls).toEqual([]);
    expect(listed).not.toHaveBeenCalled();
  });
});
