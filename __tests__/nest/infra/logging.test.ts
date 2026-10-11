/**
 * What a log line may contain, pinned. These tests run the production
 * request-logging stack (infra/http-logging.ts) and the production logger
 * options against a buffer and require that no secret value (a Firebase token,
 * X-Internal-Token, a cookie, a query service key) appears anywhere in the
 * output, so a new serializer or a new log call cannot quietly leak one. They
 * also pin request ids, the per-request log context, error serialization, the
 * Nest logger adapter and the compose hostnames that name each line's host.
 */
import fs from "fs";
import path from "path";
import express from "express";
import pino from "pino";
import request from "supertest";
import { AxiosError, AxiosHeaders } from "axios";
import { loggerOptions } from "../../../src/infra/logger-options";
import { mountRequestLogging, resolveRequestId } from "../../../src/infra/http-logging";
import { runWithLogContext } from "../../../src/infra/log-context";
import { maskUrl, serializeError } from "../../../src/infra/log-redact";
import { PinoNestLogger } from "../../../src/infra/nest-logger";
import sharedLogger from "../../../src/infra/logger";

const SECRETS = {
  bearer: "eyJhbGciOiJSUzI1NiJ9.SECRET-ID-TOKEN",
  internal: "SECRET-INTERNAL-TOKEN",
  cookie: "PHPSESSID=SECRET-SESSION",
  serviceKey: "SECRET-SERVICE-KEY",
};

type Line = Record<string, unknown>;

function capture(): { logger: pino.Logger; lines: Line[]; raw: string[] } {
  const raw: string[] = [];
  const logger = pino(
    { ...loggerOptions(), level: "debug" },
    { write: (chunk: string) => void raw.push(chunk) },
  );
  return {
    logger,
    raw,
    get lines() {
      return raw.map((l) => JSON.parse(l) as Line);
    },
  };
}

/** Lets pino-http's `finish` listener write the access line. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

function buildApp(logger: pino.Logger) {
  const app = express();
  app.set("trust proxy", 1);
  mountRequestLogging(app, logger);
  app.get("/ok", (_req, res) => {
    // Stands in for a service logging through the shared logger: no req, no
    // request id passed down.
    logger.info({ event: "test.service" }, "service line");
    res.json({ ok: true });
  });
  app.get("/bad", (_req, res) => void res.status(400).json({}));
  app.get("/boom", (_req, res) => void res.status(500).json({}));
  app.get("/health/ready", (_req, res) => void res.json({ ok: true }));
  return app;
}

describe("request logging", () => {
  it("writes no header or query secret anywhere in the output", async () => {
    // Arrange
    const out = capture();

    // Act
    await request(buildApp(out.logger))
      .get(`/ok?serviceKey=${SECRETS.serviceKey}&q=hello`)
      .set("Authorization", `Bearer ${SECRETS.bearer}`)
      .set("X-Internal-Token", SECRETS.internal)
      .set("Cookie", SECRETS.cookie)
      .set("X-App-Version", "3.5.1")
      .expect(200);
    await settle();

    // Assert
    const text = out.raw.join("");
    for (const secret of Object.values(SECRETS)) expect(text).not.toContain(secret);

    const access = out.lines.find((l) => l.msg === "request completed")!;
    expect(access).toBeDefined();
    const req = access.req as { url: string; headers: Record<string, string> };
    expect(req.url).toBe("/ok?serviceKey=%5BREDACTED%5D&q=hello");
    expect(Object.keys(req.headers)).not.toContain("authorization");
    expect(access.appVersion).toBe("3.5.1");
  });

  it("gives every line of a request the same reqId, echoed in X-Request-Id", async () => {
    // Arrange
    const out = capture();

    // Act
    const res = await request(buildApp(out.logger)).get("/ok").expect(200);
    await settle();

    // Assert
    const id = res.headers["x-request-id"];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const service = out.lines.find((l) => l.event === "test.service")!;
    const access = out.lines.find((l) => l.msg === "request completed")!;
    expect(service.reqId).toBe(id);
    expect(access.reqId).toBe(id);
  });

  it("keeps a service line's fields off the access line", async () => {
    // Arrange
    const out = capture();

    // Act
    await request(buildApp(out.logger)).get("/ok").expect(200);
    await settle();

    // Assert
    const access = out.lines.find((l) => l.msg === "request completed")!;
    expect(access.reqId).toBeDefined();
    expect(access).not.toHaveProperty("event");
  });

  it("levels the access line by status and skips health probes", async () => {
    // Arrange
    const out = capture();
    const app = buildApp(out.logger);

    // Act
    await request(app).get("/ok");
    await request(app).get("/bad");
    await request(app).get("/missing");
    await request(app).get("/boom");
    await request(app).get("/health/ready");
    await settle();

    // Assert
    const levelOf = (url: string) =>
      out.lines.find((l) => (l.req as { url?: string } | undefined)?.url === url)?.level;
    expect(levelOf("/ok")).toBe("info");
    expect(levelOf("/bad")).toBe("warn");
    expect(levelOf("/missing")).toBe("info");
    expect(levelOf("/boom")).toBe("error");
    expect(levelOf("/health/ready")).toBeUndefined();
  });

  it("writes ISO timestamps, string levels and the service fields", () => {
    // Arrange
    const out = capture();

    // Act
    out.logger.info("x");

    // Assert
    const [line] = out.lines;
    expect(line!.level).toBe("info");
    expect(line!.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(line!.service).toBe("skkuverse-server");
    expect(line!.role).toBeDefined();
    expect(line!.reqId).toBeUndefined();
  });
});

describe("log context", () => {
  // pino's default merge writes each line's fields into the request's context,
  // so every later line of the request (the access line included) would carry
  // them: one event counted twice, an `err` on a 200.
  it("does not carry one line's fields into the next line of the same request", () => {
    // Arrange
    const out = capture();

    // Act
    runWithLogContext({ reqId: "req-1" }, () => {
      out.logger.info({ event: "test.first", cached: true, err: new Error("boom") }, "first");
      out.logger.info("second");
    });

    // Assert
    const [first, second] = out.lines;
    expect(first).toMatchObject({ event: "test.first", cached: true, reqId: "req-1" });
    expect(first!.err).toBeDefined();
    expect(second!.reqId).toBe("req-1");
    expect(second).not.toHaveProperty("event");
    expect(second).not.toHaveProperty("cached");
    expect(second).not.toHaveProperty("err");
  });
});

describe("resolveRequestId", () => {
  it("adopts a well-formed client id", () => {
    // Act & Assert
    expect(resolveRequestId({ "x-request-id": "abc-123" })).toBe("abc-123");
  });
  it("prefers CF-Ray over a generated id, and replaces a malformed client id", () => {
    // Act & Assert
    expect(resolveRequestId({ "cf-ray": "8c1a2b3c4d5e6f70-ICN" })).toBe("8c1a2b3c4d5e6f70-ICN");
    expect(
      resolveRequestId({ "x-request-id": "bad id\n", "cf-ray": "8c1a2b3c4d5e6f70-ICN" }),
    ).toBe("8c1a2b3c4d5e6f70-ICN");
    expect(resolveRequestId({ "x-request-id": "x".repeat(65) })).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("error serialization", () => {
  it("keeps an axios error's place and drops its request config", () => {
    // Arrange
    const config = {
      method: "get",
      url: `https://ws.bus.go.kr/api/rest/arrive?serviceKey=${SECRETS.serviceKey}&busRouteId=1`,
      headers: new AxiosHeaders({ Cookie: SECRETS.cookie, Authorization: SECRETS.bearer }),
    };
    const err = new AxiosError("timeout of 10000ms exceeded", "ECONNABORTED", config);
    const out = capture();

    // Act
    out.logger.error({ err }, "upstream failed");

    // Assert
    const text = out.raw.join("");
    for (const secret of Object.values(SECRETS)) expect(text).not.toContain(secret);
    const logged = out.lines[0]!.err as Record<string, unknown>;
    expect(logged.message).toBe("timeout of 10000ms exceeded");
    expect(logged.stack).toBeDefined();
    expect(logged.http).toEqual({
      method: "GET",
      url: "https://ws.bus.go.kr/api/rest/arrive?serviceKey=%5BREDACTED%5D&busRouteId=1",
      status: undefined,
    });
  });

  it("scrubs an axios error nested as a cause", () => {
    // Arrange
    const inner = new AxiosError("bad", "ERR", {
      headers: new AxiosHeaders({ Cookie: SECRETS.cookie }),
    });
    const outer = new Error("wrapped", { cause: inner });

    // Act & Assert
    expect(JSON.stringify(serializeError(outer))).not.toContain(SECRETS.cookie);
  });

  it("passes non-errors through", () => {
    // Act & Assert
    expect(serializeError("plain")).toBe("plain");
  });
});

describe("maskUrl", () => {
  it("masks secret-looking parameters and keeps the rest", () => {
    // Act & Assert
    expect(maskUrl("/a?token=1&page=2")).toBe("/a?token=%5BREDACTED%5D&page=2");
    expect(maskUrl("/a?api_key=1")).toBe("/a?api_key=%5BREDACTED%5D");
    expect(maskUrl("/plain")).toBe("/plain");
  });
});

describe("PinoNestLogger", () => {
  afterEach(() => jest.restoreAllMocks());

  it("drops Nest's route and module announcements to debug", () => {
    // Arrange
    const info = jest.spyOn(sharedLogger, "info");
    const debug = jest.spyOn(sharedLogger, "debug");
    const nest = new PinoNestLogger();

    // Act
    nest.log("Mapped {/bus, GET} route", "RouterExplorer");
    nest.log("Nest application successfully started", "NestApplication");

    // Assert
    expect(debug).toHaveBeenCalledWith({ module: "nest.RouterExplorer" }, "Mapped {/bus, GET} route");
    expect(info).toHaveBeenCalledWith(
      { module: "nest.NestApplication" },
      "Nest application successfully started",
    );
  });

  it("keeps the stack from error(message, stack, context)", () => {
    // Arrange
    const error = jest.spyOn(sharedLogger, "error");

    // Act
    new PinoNestLogger().error("boom", "Error: boom\n    at x", "ExceptionHandler");

    // Assert
    expect(error).toHaveBeenCalledWith(
      { module: "nest.ExceptionHandler", stack: "Error: boom\n    at x" },
      "boom",
    );
  });
});

describe("docker-compose hostnames", () => {
  // The `hostname` field of a line is os.hostname(); without an explicit
  // hostname it is a container id that changes on every deploy.
  it("names every service's host after the service", () => {
    // Arrange
    const compose = fs.readFileSync(path.join(__dirname, "../../../docker-compose.yml"), "utf8");

    // Act
    const services = compose.slice(
      compose.indexOf("\nservices:\n"),
      compose.indexOf("\nnetworks:\n"),
    );
    const blocks = [...services.matchAll(/^ {2}([a-z0-9-]+):\n((?: {4}.*\n|\n)*)/gm)];

    // Assert
    expect(blocks.length).toBeGreaterThan(1);
    for (const [, name, body] of blocks) {
      expect(body).toMatch(new RegExp(`^ {4}hostname: ${name}$`, "m"));
    }
  });
});
