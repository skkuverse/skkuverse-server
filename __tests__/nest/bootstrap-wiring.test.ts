/**
 * Pins the main.ts production bootstrap wiring that a review found broken and
 * untested:
 *
 *  1. NestFactory.create on a PRE-BUILT ExpressAdapter MUST pass
 *     { bodyParser: false }. Otherwise app.init() runs
 *     registerParserMiddleware → ExpressAdapter.isMiddlewareApplied, which
 *     reads the `app.router` getter that express@4.22 removed and now THROWS
 *     ('app.router' is deprecated!), crashing the boot. Every spec previously
 *     used build-bus-app.ts (which DOES pass bodyParser:false), so the prod
 *     path was never exercised. This test boots BOTH ways to lock the fix in.
 *
 *  2. LangMiddleware must run app-wide. Nest's consumer.forRoutes("*") does
 *     NOT fire against a pre-built ExpressAdapter (verified: zero invocations).
 *     main.ts therefore mounts it as raw express middleware before
 *     NestFactory.create — this test asserts req.lang / Vary actually land.
 *
 * The regression pins boot their own copy of the pipeline, because they vary
 * exactly what it fixes (bodyParser, the raw LangMiddleware). The CORS policy
 * runs through the production pipeline itself (bootstrapHttpApp, via
 * buildTestApp). Both use a minimal one-controller module (no DB / external
 * APIs), so they cover the wiring without the full AppModule's env + Mongo
 * requirements.
 */
import { Controller, Get, Module, Post, Req } from "@nestjs/common";
import { ExpressAdapter } from "@nestjs/platform-express";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import express from "express";
import request from "supertest";
import { LangMiddleware } from "../../src/http/lang.middleware";
import config from "../../src/infra/config";
import { CORS_METHODS, WEBVIEW_ORIGIN } from "../../src/infra/origins";
import { buildTestApp } from "../helpers/nest/build-test-app";

@Controller("ping")
class PingController {
  @Get()
  ping(@Req() req: express.Request): { lang: unknown } {
    // Read req.lang to prove LangMiddleware ran before the handler.
    return { lang: (req as { lang?: unknown }).lang };
  }
}

@Module({ controllers: [PingController] })
class MiniModule {}

function buildLikeMainTs(opts: {
  bodyParser?: false;
  mountLang: boolean;
}): Promise<NestExpressApplication> {
  return (async () => {
    const expressInstance = express();
    expressInstance.set("trust proxy", 1);
    expressInstance.use(express.json({ limit: "100kb" }));
    if (opts.mountLang) {
      const lang = new LangMiddleware();
      expressInstance.use((req, res, next) =>
        lang.use(req as never, res as never, next),
      );
    }
    const moduleRef = await Test.createTestingModule({
      imports: [MiniModule],
    }).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>(
      new ExpressAdapter(expressInstance),
      opts.bodyParser === false ? { bodyParser: false } : {},
    );
    await app.listen(0, "127.0.0.1");
    return app;
  })();
}

describe("main.ts bootstrap wiring (regression pins)", () => {
  it("boots with { bodyParser: false } on a pre-built ExpressAdapter (express 4.22)", async () => {
    const app = await buildLikeMainTs({ bodyParser: false, mountLang: true });
    const res = await request(app.getHttpServer()).get("/ping");
    expect(res.status).toBe(200);
    await app.close();
  });

  it("WITHOUT bodyParser:false the prebuilt adapter crashes on app.router (proves the fix is load-bearing)", async () => {
    await expect(
      buildLikeMainTs({ mountLang: true }),
    ).rejects.toThrow(/app\.router/);
  });

  it("raw-mounted LangMiddleware fires app-wide: req.lang set + Vary header", async () => {
    const app = await buildLikeMainTs({ bodyParser: false, mountLang: true });
    const res = await request(app.getHttpServer())
      .get("/ping")
      .set("Accept-Language", "en-US,en;q=0.9");
    expect(res.status).toBe(200);
    expect(res.body.lang).toBe("en");
    expect(res.headers["vary"]).toBe("Accept-Language");
    await app.close();
  });

  it("defaults req.lang to ko when no Accept-Language header is sent", async () => {
    const app = await buildLikeMainTs({ bodyParser: false, mountLang: true });
    const res = await request(app.getHttpServer()).get("/ping");
    expect(res.body.lang).toBe("ko");
    await app.close();
  });

  it("Nest forRoutes('*') does NOT fire on a pre-built adapter (documents why main.ts mounts lang raw)", async () => {
    // If lang is NOT mounted raw, req.lang is undefined — confirming the
    // forRoutes('*') path AppModule used to rely on would leave it unset.
    const app = await buildLikeMainTs({ bodyParser: false, mountLang: false });
    const res = await request(app.getHttpServer()).get("/ping");
    expect(res.body.lang).toBeUndefined();
    await app.close();
  });
});

/**
 * CORS (skkuverse#17).
 *
 * apps/webview fetches the mini-app notification feed cross-origin. Before this
 * existed the API sent no Access-Control-Allow-Origin and answered OPTIONS with
 * 404, so the page could not read a single byte — and the failure was invisible
 * server-side, because the request either never arrived or arrived and answered
 * fine while the browser discarded it.
 *
 * These pin the policy, not the plumbing: which origin, which methods, and that
 * credentials stay off.
 */
describe("CORS policy", () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await buildTestApp({ imports: [MiniModule] });
  });

  afterAll(async () => {
    await app.close();
  });

  it("allows the webview origin to read a GET", async () => {
    const res = await request(app.getHttpServer())
      .get("/ping")
      .set("Origin", WEBVIEW_ORIGIN);
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(WEBVIEW_ORIGIN);
  });

  it("answers the preflight instead of 404ing it", async () => {
    const res = await request(app.getHttpServer())
      .options("/ping")
      .set("Origin", WEBVIEW_ORIGIN)
      .set("Access-Control-Request-Method", "GET");
    expect(res.status).toBeLessThan(300);
    expect(res.headers["access-control-allow-origin"]).toBe(WEBVIEW_ORIGIN);
  });

  // WHY: without Access-Control-Max-Age a browser repeats the preflight before every cross-origin GET.
  it("lets a browser cache the preflight for a day", async () => {
    // Act
    const res = await request(app.getHttpServer())
      .options("/ping")
      .set("Origin", WEBVIEW_ORIGIN)
      .set("Access-Control-Request-Method", "GET");

    // Assert
    expect(res.headers["access-control-max-age"]).toBe("86400");
  });

  it("grants nothing to an origin that is not ours", async () => {
    const res = await request(app.getHttpServer())
      .get("/ping")
      .set("Origin", "https://evil.test");
    // The response still succeeds — CORS is enforced by the browser, not the
    // server — but without the header the browser discards it.
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("does not offer POST, so /internal/* can never be preflighted from a page", async () => {
    expect([...CORS_METHODS]).not.toContain("POST");
    const res = await request(app.getHttpServer())
      .options("/ping")
      .set("Origin", WEBVIEW_ORIGIN)
      .set("Access-Control-Request-Method", "POST");
    expect(res.headers["access-control-allow-methods"] ?? "").not.toContain("POST");
  });

  it("never sends Allow-Credentials — nothing here is per-user", async () => {
    const res = await request(app.getHttpServer())
      .get("/ping")
      .set("Origin", WEBVIEW_ORIGIN);
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("exposes the freshness headers the event map clock correction needs", async () => {
    const res = await request(app.getHttpServer())
      .get("/ping")
      .set("Origin", WEBVIEW_ORIGIN);
    expect(res.headers["access-control-expose-headers"]).toContain("ETag");
  });

  // WHY: a cross-origin client revalidates with the ETag, so a 304 must expose it too. The cors
  // setup is the only thing that sets the expose header, and this pins that it covers the 304.
  it("still exposes ETag on a 304 revalidation, from the cors setup alone", async () => {
    // Arrange
    const first = await request(app.getHttpServer())
      .get("/ping")
      .set("Origin", WEBVIEW_ORIGIN);
    const etag = String(first.headers["etag"]);

    // Act
    const res = await request(app.getHttpServer())
      .get("/ping")
      .set("Origin", WEBVIEW_ORIGIN)
      .set("If-None-Match", etag);

    // Assert
    expect(first.headers["etag"]).toBeDefined();
    expect(res.status).toBe(304);
    expect(res.headers["access-control-expose-headers"]).toContain("ETag");
  });

  it("grants nothing to a loopback origin outside development", async () => {
    const res = await request(app.getHttpServer())
      .get("/ping")
      .set("Origin", "http://localhost:5173");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

/**
 * Development adds loopback origins, so a web dev server on this machine (the
 * webview SPA's vite) can read a local API. Nothing broader: not a LAN address,
 * not a host that merely starts with "localhost".
 */
describe("CORS policy in development", () => {
  let app: NestExpressApplication;
  let isDevelopment: jest.ReplaceProperty<boolean>;

  beforeAll(async () => {
    // WHY: bootstrapHttpApp reads config.isDevelopment when it builds the app, as main.ts does.
    isDevelopment = jest.replaceProperty(config, "isDevelopment", true);
    app = await buildTestApp({ imports: [MiniModule] });
  });

  afterAll(async () => {
    await app.close();
    isDevelopment.restore();
  });

  it.each(["http://localhost:5173", "http://127.0.0.1:8081", "http://localhost"])(
    "allows %s",
    async (origin) => {
      const res = await request(app.getHttpServer()).get("/ping").set("Origin", origin);
      expect(res.headers["access-control-allow-origin"]).toBe(origin);
    },
  );

  it.each(["http://192.168.0.5:5173", "http://localhost.evil.test", "https://localhost:5173"])(
    "grants nothing to %s",
    async (origin) => {
      const res = await request(app.getHttpServer()).get("/ping").set("Origin", origin);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    },
  );

  it("still allows the webview origin", async () => {
    const res = await request(app.getHttpServer()).get("/ping").set("Origin", WEBVIEW_ORIGIN);
    expect(res.headers["access-control-allow-origin"]).toBe(WEBVIEW_ORIGIN);
  });
});

/**
 * Every step bootstrapHttpApp mounts, through the pipeline itself (PR 218 F1): the regression
 * pins above boot their own copy, and the response diff after a deploy compares bodies only, so
 * a deleted helmet, logging, body-limit, trust-proxy or no-store line would otherwise ship green.
 */
@Controller("pipeline")
class PipelineController {
  @Get()
  ip(@Req() req: express.Request): { ip: string | undefined } {
    return { ip: req.ip };
  }

  @Post()
  echo(@Req() req: express.Request): { bodyLength: number } {
    // WHY: the length of the parsed body proves express.json ran; an unparsed body is undefined.
    return { bodyLength: JSON.stringify(req.body ?? null).length };
  }
}

@Module({ controllers: [PipelineController] })
class PipelineModule {}

type StackLayer = { name: string };

/** The names of the Express middleware layers, in mount order. */
function layerNames(app: NestExpressApplication): string[] {
  const instance = app.getHttpAdapter().getInstance() as { _router: { stack: StackLayer[] } };
  return instance._router.stack.map((layer) => layer.name);
}

/** The first `count` layers after Express's own: the ones bootstrapHttpApp mounts before Nest adds its own. */
function pipelineLayers(app: NestExpressApplication, count: number): string[] {
  const names = layerNames(app);
  return names.slice(names.indexOf("expressInit") + 1).slice(0, count);
}

describe("bootstrapHttpApp pipeline", () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await buildTestApp({ imports: [PipelineModule] });
  });

  afterAll(async () => {
    await app.close();
  });

  it("mounts helmet, request logging, the JSON parser and the lang middleware in that order", () => {
    // Arrange
    // pino-http's middleware is named `result`; the lang wrapper is an inline arrow.
    const expected = ["helmetMiddleware", "requestContext", "result", "jsonParser", "<anonymous>"];

    // Act
    const layers = pipelineLayers(app, expected.length + 1);

    // Assert
    expect(layers.slice(0, expected.length)).toEqual(expected);
    expect(layers.at(-1)).not.toBe("noStoreMiddleware");
  });

  it("trusts one proxy hop, so req.ip is the rightmost X-Forwarded-For address", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/pipeline").set("X-Forwarded-For", "203.0.113.1, 198.51.100.7");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.ip).toBe("198.51.100.7");
  });

  it("sends helmet's headers", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/pipeline");

    // Assert
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
  });

  it("tags each response with an X-Request-Id, echoing a valid one the client sent", async () => {
    // Act
    const generated = await request(app.getHttpServer()).get("/pipeline");
    const echoed = await request(app.getHttpServer()).get("/pipeline").set("X-Request-Id", "req-123");

    // Assert
    expect(generated.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(echoed.headers["x-request-id"]).toBe("req-123");
  });

  it("parses a JSON body up to 100 kB and refuses a larger one", async () => {
    // Arrange
    const under = { text: "x".repeat(90_000) };
    const over = { text: "x".repeat(110_000) };

    // Act
    const accepted = await request(app.getHttpServer()).post("/pipeline").send(under);
    const refused = await request(app.getHttpServer()).post("/pipeline").send(over);

    // Assert
    expect(accepted.status).toBe(201);
    expect(accepted.body.data.bodyLength).toBe(JSON.stringify(under).length);
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(refused.body.data).toBeUndefined();
  });

  it("runs the lang middleware before the handler: meta.lang and Vary", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/pipeline").set("Accept-Language", "en-US,en;q=0.9");

    // Assert
    expect(res.body.meta).toEqual({ lang: "en" });
    expect(res.headers["vary"]).toContain("Accept-Language");
  });

  it("leaves Cache-Control alone while the cache is on", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/pipeline");

    // Assert
    expect(layerNames(app)).not.toContain("noStoreMiddleware");
    expect(res.headers["cache-control"]).toBeUndefined();
  });
});

describe("bootstrapHttpApp pipeline with CACHE=off", () => {
  let app: NestExpressApplication;
  let cacheEnabled: jest.ReplaceProperty<boolean>;

  beforeAll(async () => {
    // WHY: bootstrapHttpApp reads config.cache.enabled when it builds the app, as main.ts does.
    cacheEnabled = jest.replaceProperty(config.cache, "enabled", false);
    app = await buildTestApp({ imports: [PipelineModule] });
  });

  afterAll(async () => {
    await app.close();
    cacheEnabled.restore();
  });

  it("mounts the no-store middleware last, after the lang middleware", () => {
    // Act
    const layers = pipelineLayers(app, 6);

    // Assert
    expect(layers).toEqual(["helmetMiddleware", "requestContext", "result", "jsonParser", "<anonymous>", "noStoreMiddleware"]);
  });

  it("answers every response with Cache-Control: no-store", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/pipeline");

    // Assert
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});
