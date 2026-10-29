/**
 * The local-development perimeter (ADR 0023, D2): it passes every port's contract, says on construction that it
 * is not the production perimeter, refuses to construct for a host off loopback, and decides only what a developer
 * on their own machine needs: loopback CORS, an http(s) fetch to any public host, every internal scope and push
 * sender allowed.
 */
import axios from "axios";
import express from "express";
import admin from "firebase-admin";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { LoopbackServers } from "../../../__tests__/helpers/nest/loopback-servers";
import { describeAbuseSignalsContract } from "../../../__tests__/helpers/perimeter/abuse-signals.contract";
import { describeInternalAuthorizerContract } from "../../../__tests__/helpers/perimeter/internal-authorizer.contract";
import { describeMiniAppPushAuthorizerContract } from "../../../__tests__/helpers/perimeter/mini-app-push-authorizer.contract";
import { describeMiniAppPushQuotaContract } from "../../../__tests__/helpers/perimeter/mini-app-push-quota.contract";
import { describeOriginTrustContract } from "../../../__tests__/helpers/perimeter/origin-trust.contract";
import { describeOutboundPolicyContract } from "../../../__tests__/helpers/perimeter/outbound-policy.contract";
import { capturingLogger, perimeterRequest, perimeterTestDeps } from "../../../__tests__/helpers/perimeter/perimeter-deps";
import { describePushContentPolicyContract } from "../../../__tests__/helpers/perimeter/push-content-policy.contract";
import { describeRateLimitPolicyContract } from "../../../__tests__/helpers/perimeter/rate-limit-policy.contract";
import { describeRequestAuthenticatorContract } from "../../../__tests__/helpers/perimeter/request-authenticator.contract";
import { OutboundBlockedError } from "../../shared/outbound-blocked.error";
import { INTERNAL_SCOPES, PORT_LABELS, PORT_NAMES, RATE_LIMIT_CLASSES } from "../perimeter.ports";
import { LOCAL_DEV_CLASSES } from "./perimeter-classes";

describe("LOCAL_DEV_CLASSES", () => {
  describeRequestAuthenticatorContract((deps) => new LOCAL_DEV_CLASSES.requestAuthenticator(deps));
  describeRateLimitPolicyContract((deps) => new LOCAL_DEV_CLASSES.rateLimitPolicy(deps));
  describeInternalAuthorizerContract((deps) => new LOCAL_DEV_CLASSES.internalAuthorizer(deps));
  describeMiniAppPushAuthorizerContract((deps) => new LOCAL_DEV_CLASSES.miniAppPushAuthorizer(deps));
  describeMiniAppPushQuotaContract((deps) => new LOCAL_DEV_CLASSES.miniAppPushQuota(deps));
  describePushContentPolicyContract((deps) => new LOCAL_DEV_CLASSES.pushContentPolicy(deps));
  describeOriginTrustContract((deps) => new LOCAL_DEV_CLASSES.originTrust(deps));
  describeOutboundPolicyContract((deps) => new LOCAL_DEV_CLASSES.outboundPolicy(deps));
  describeAbuseSignalsContract((deps) => new LOCAL_DEV_CLASSES.abuseSignals(deps));

  it.each(PORT_NAMES)("warns on constructing %s that it is not the production perimeter", (name) => {
    // Arrange
    const { logger, lines } = capturingLogger();

    // Act
    new LOCAL_DEV_CLASSES[name](perimeterTestDeps({ logger }));

    // Assert
    expect(lines).toEqual([expect.objectContaining({ level: 40, event: "perimeter.local_dev.constructed", port: PORT_LABELS[name] })]);
  });

  it.each(PORT_NAMES)("refuses to construct %s for a host off loopback, and constructs for the poller, which has none", (name) => {
    // Act & Assert
    expect(() => new LOCAL_DEV_CLASSES[name](perimeterTestDeps({ host: "0.0.0.0" }))).toThrow(/serves loopback only \(HOST=0\.0\.0\.0\)/);
    expect(() => new LOCAL_DEV_CLASSES[name](perimeterTestDeps({ host: null }))).not.toThrow();
    expect(() => new LOCAL_DEV_CLASSES[name](perimeterTestDeps({ host: "::1" }))).not.toThrow();
  });
});

describe("the LocalDev class for requestAuthenticator", () => {
  it("verifies on a Firebase app of its own, named and made on first use, for the configured project", async () => {
    // Arrange
    let isolated: { firebase: typeof admin; Authenticator: typeof LOCAL_DEV_CLASSES.requestAuthenticator } | undefined;
    jest.isolateModules(() => {
      isolated = {
        firebase: require("firebase-admin") as typeof admin,
        Authenticator: (require("./request-authenticator") as typeof import("./request-authenticator")).LocalDevRequestAuthenticator,
      };
    });
    const { firebase, Authenticator } = isolated!;
    const authenticator = new Authenticator(perimeterTestDeps());
    const appsBefore = firebase.apps.map((app) => app?.name);

    // Act
    await authenticator.authenticate(perimeterRequest({ headers: { Authorization: "Bearer not-a-token" } }));
    await authenticator.authenticate(perimeterRequest({ headers: { Authorization: "Bearer another" } }));

    // Assert
    expect(appsBefore).toEqual([]);
    expect(firebase.apps.map((app) => app?.name)).toEqual(["perimeter-local-dev"]);
    expect(firebase.app("perimeter-local-dev").options.projectId).toBe("demo-perimeter-contract");
  });
});

describe("the LocalDev class for rateLimitPolicy", () => {
  const servers = new LoopbackServers();

  afterEach(async () => {
    await servers.closeAll();
  });

  it("serves each class with a handler of its own", () => {
    // Arrange
    const policy = new LOCAL_DEV_CLASSES.rateLimitPolicy(perimeterTestDeps());

    // Act
    const handlers = new Set(RATE_LIMIT_CLASSES.map((limitClass) => policy.handlerFor(limitClass)));

    // Assert
    expect(handlers.size).toBe(RATE_LIMIT_CLASSES.length);
  });

  // WHY: /notices/overview passes the notices and the notices-overview bindings; one shared count would spend two.
  it("counts a request that passes two classes once in each", async () => {
    // Arrange
    const policy = new LOCAL_DEV_CLASSES.rateLimitPolicy(perimeterTestDeps());
    const app = express();
    app.use(policy.handlerFor("notices"), policy.handlerFor("notices-overview"));
    app.get("/notices/overview", (_req, res) => {
      res.json({ ok: true });
    });
    const server = await servers.serve(app);
    const alone = express();
    alone.use(new LOCAL_DEV_CLASSES.rateLimitPolicy(perimeterTestDeps()).handlerFor("notices-overview"));
    alone.get("/notices/overview", (_req, res) => {
      res.json({ ok: true });
    });
    const aloneServer = await servers.serve(alone);

    // Act
    const res = await request(server).get("/notices/overview");
    const aloneRes = await request(aloneServer).get("/notices/overview");

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["ratelimit-remaining"]).toBe(aloneRes.headers["ratelimit-remaining"]);
  });
});

describe("the LocalDev class for internalAuthorizer", () => {
  it.each(INTERNAL_SCOPES)("allows %s without a credential", async (scope) => {
    // Act & Assert
    await expect(new LOCAL_DEV_CLASSES.internalAuthorizer(perimeterTestDeps()).authorize(scope, perimeterRequest())).resolves.toBe(true);
  });
});

describe("the LocalDev class for miniAppPushAuthorizer", () => {
  it("allows any sender whose body arrived as sent", async () => {
    // Arrange
    const authorizer = new LOCAL_DEV_CLASSES.miniAppPushAuthorizer(perimeterTestDeps());

    // Act
    const decision = await authorizer.authorize({
      senderId: "unregistered",
      scope: "push.send",
      request: perimeterRequest({ method: "POST" }),
      rawBody: Buffer.from("{}"),
      credentials: null,
    });

    // Assert
    expect(decision).toEqual({ allowed: true, keyId: null });
  });
});

describe("the LocalDev class for pushContentPolicy", () => {
  it("keeps a link of a known action type and the English texts", async () => {
    // Arrange
    const policy = new LOCAL_DEV_CLASSES.pushContentPolicy(perimeterTestDeps());
    const draft = { title_ko: " 제목 ", body_ko: "본문", title_en: "Title", actionType: "webview", actionValue: "https://example.com/a" };

    // Act
    const checked = await policy.check(draft, { senderId: "mukja", gameIds: [], isKnownMiniAppTarget: () => false });

    // Assert
    expect(checked).toEqual({
      content: { title_ko: "제목", body_ko: "본문", title_en: "Title", body_en: null, actionType: "webview", actionValue: "https://example.com/a" },
    });
  });

  it("refuses an unknown action type or a type without a value", async () => {
    // Arrange
    const policy = new LOCAL_DEV_CLASSES.pushContentPolicy(perimeterTestDeps());
    const scope = { senderId: "mukja", gameIds: [], isKnownMiniAppTarget: () => false };

    // Act
    const unknown = await policy.check({ title_ko: "t", body_ko: "b", actionType: "telnet", actionValue: "x" }, scope);
    const valueless = await policy.check({ title_ko: "t", body_ko: "b", actionType: "route" }, scope);

    // Assert
    expect("problems" in unknown).toBe(true);
    expect("problems" in valueless).toBe(true);
  });
});

describe("the LocalDev class for originTrust", () => {
  it.each([
    ["http://localhost:5173", true],
    ["http://127.0.0.1:8081", true],
    ["http://localhost", true],
    ["https://localhost:5173", false],
    ["http://localhost.evil.test", false],
    ["http://192.168.0.5:5173", false],
    ["https://apple-game.game.skkuverse.com", false],
    ["https://webview.skkuverse.com", false],
  ])("trusts %s: %s", (origin, trusted) => {
    // Act & Assert
    expect(new LOCAL_DEV_CLASSES.originTrust(perimeterTestDeps()).isCorsOrigin(origin)).toBe(trusted);
  });
});

describe("the LocalDev class for outboundPolicy", () => {
  const servers = new LoopbackServers();

  afterEach(async () => {
    await servers.closeAll();
  });

  it("allows an http or https URL on any public host, with no domain allowlist", () => {
    // Arrange
    const policy = new LOCAL_DEV_CLASSES.outboundPolicy(perimeterTestDeps());

    // Act & Assert
    expect(policy.allows("notice-attachment", "https://files.example/a.pdf")).toBe(true);
    expect(policy.allows("notice-attachment", "http://8.8.8.8/a.pdf")).toBe(true);
  });

  it.each(["http://127.0.0.1/a.pdf", "http://[::1]/a.pdf", "http://169.254.169.254/opc/v1/instance/", "http://10.0.0.1/a.pdf", "https://files.example:8443/a.pdf"])(
    "refuses %s: a non-public address, or a port other than the scheme's",
    (url) => {
      // Act & Assert
      expect(new LOCAL_DEV_CLASSES.outboundPolicy(perimeterTestDeps()).allows("notice-attachment", url)).toBe(false);
    },
  );

  it("fetches through agents that refuse a hostname resolving to loopback, and recognizes that refusal", async () => {
    // Arrange
    const policy = new LOCAL_DEV_CLASSES.outboundPolicy(perimeterTestDeps());
    const server = await servers.serve((_req, res) => res.end("internal"));
    const { port } = server.address() as AddressInfo;

    // Act
    const err = await axios.get(`http://localhost:${port}/`, { ...policy.requestConfig("notice-attachment"), timeout: 2000 }).catch((e: unknown) => e);

    // Assert
    expect(policy.isBlocked(err)).toBe(true);
  });

  it("refuses a redirect hop to a loopback address", () => {
    // Arrange
    const { beforeRedirect } = new LOCAL_DEV_CLASSES.outboundPolicy(perimeterTestDeps()).requestConfig("notice-attachment");

    // Act & Assert
    expect(() => beforeRedirect?.({ href: "http://127.0.0.1:3000/internal" } as never, {} as never, {} as never)).toThrow(OutboundBlockedError);
  });
});
