/**
 * What reaches Sentry, pinned.
 *
 * Runs the real SDK with the production options (infra/sentry-options.ts) and a
 * transport that records envelopes instead of sending them, then requires:
 *  - no token, cookie or service key in an error event (built by the SDK from
 *    the request and from outgoing-call breadcrumbs);
 *  - no log line at all: Sentry is for errors, Grafana Loki for logs;
 *  - only unknown errors become Issues: an AppError is an answer, not a fault;
 *  - no trace header on an outgoing call: the data.go.kr gateway refuses a
 *    request whose header holds `environment=`, which `baggage` does.
 */
import pino from "pino";
import * as Sentry from "@sentry/nestjs";
import axios, { AxiosError, AxiosHeaders } from "axios";
import type { IncomingHttpHeaders } from "node:http";
import type { ArgumentsHost } from "@nestjs/common";
import { sentryOptions } from "../../../src/infra/sentry-options";
import { loggerOptions } from "../../../src/infra/logger-options";
import { runWithLogContext } from "../../../src/infra/log-context";
import { flattenLogAttributes, scrubBreadcrumb, scrubEvent } from "../../../src/infra/sentry-scrub";
import { HttpExceptionFilter } from "../../../src/http/http-exception.filter";
import { AppError } from "../../../src/http/app.error";
import { LoopbackServers } from "../../helpers/nest/loopback-servers";

const SECRETS = {
  bearer: "SECRET-ID-TOKEN",
  internal: "SECRET-INTERNAL-TOKEN",
  cookie: "PHPSESSID=SECRET-SESSION",
  serviceKey: "SECRET-SERVICE-KEY",
};

const sent: unknown[] = [];

beforeAll(() => {
  Sentry.init({
    ...sentryOptions(),
    dsn: "https://public@o1.ingest.sentry.io/1",
    environment: "test",
    transport: () => ({
      send: async (envelope) => {
        sent.push(envelope);
        return {};
      },
      flush: async () => true,
    }),
  });
});

afterAll(async () => {
  await Sentry.close(1000);
});

beforeEach(() => {
  sent.length = 0;
});

const sentText = () => JSON.stringify(sent);

/** Event payloads of a given envelope item type ("event", "log", ...). */
function items(type: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const envelope of sent as [unknown, [{ type: string }, unknown][]][]) {
    for (const [header, payload] of envelope[1]) {
      if (header.type === type) out.push(payload as Record<string, unknown>);
    }
  }
  return out;
}

function fakeHost(req: object): { host: ArgumentsHost; res: { statusCode?: number } } {
  const res = {
    headersSent: false,
    statusCode: undefined as number | undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json() {
      return this;
    },
    setHeader() {},
  };
  const host = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

describe("error events", () => {
  it("carry no secret from the request or from outgoing-call breadcrumbs", async () => {
    // Arrange
    Sentry.addBreadcrumb({
      category: "http",
      data: {
        url: `https://ws.bus.go.kr/api/rest/arrive?serviceKey=${SECRETS.serviceKey}`,
        "http.query": `serviceKey=${SECRETS.serviceKey}`,
      },
    });

    // Act
    Sentry.captureEvent({
      message: "boom",
      request: {
        url: `https://api.skkuverse.com/bus/config?serviceKey=${SECRETS.serviceKey}`,
        query_string: `serviceKey=${SECRETS.serviceKey}&lang=ko`,
        headers: {
          authorization: `Bearer ${SECRETS.bearer}`,
          "x-internal-token": SECRETS.internal,
          cookie: SECRETS.cookie,
          "user-agent": "okhttp/4.12.0",
        },
        cookies: { PHPSESSID: SECRETS.cookie },
        data: { token: SECRETS.internal },
      },
    });
    await Sentry.flush(1000);

    // Assert
    const text = sentText();
    for (const secret of Object.values(SECRETS)) expect(text).not.toContain(secret);
    const [event] = items("event");
    const request = event!.request as Record<string, unknown>;
    expect(request.headers).toEqual({ "user-agent": "okhttp/4.12.0" });
    expect(request.query_string).toBe("serviceKey=%5BREDACTED%5D&lang=ko");
  });

  it("are raised by the filter for unknown errors only, tagged with the request id", async () => {
    // Arrange
    const filter = new HttpExceptionFilter();
    const req = { method: "GET", path: "/x" };

    // Act
    filter.catch(new AppError("BAD", "bad input", 400), fakeHost(req).host);
    const { host, res } = fakeHost(req);
    runWithLogContext({ reqId: "req-123" }, () => filter.catch(new Error("kaboom"), host));
    await Sentry.flush(1000);

    // Assert
    expect(res.statusCode).toBe(500);
    const events = items("event");
    expect(events).toHaveLength(1);
    expect((events[0]!.tags as Record<string, string>).request_id).toBe("req-123");
    expect(JSON.stringify(events[0]!.exception)).toContain("kaboom");
  });

  // WHY: the release stays the server commit, so source maps and release history keep their meaning; the overlay
  // compiled into the image rides along as a tag.
  it("are tagged with the perimeter overlay the image carries, `none` for a build without one", async () => {
    // Act
    Sentry.captureEvent({ message: "boom" });
    await Sentry.flush(1000);

    // Assert
    const [event] = items("event");
    expect((event!.tags as Record<string, string>).perimeter_overlay).toBe("none");
  });
});

describe("logs", () => {
  it("never leave for Sentry, at any level: Grafana Loki carries them", async () => {
    // Arrange
    const logger = pino({ ...loggerOptions(), level: "debug" }, { write: () => {} });
    const err = new AxiosError("timeout", "ECONNABORTED", {
      url: `https://ws.bus.go.kr/x?serviceKey=${SECRETS.serviceKey}`,
      headers: new AxiosHeaders({ Cookie: SECRETS.cookie }),
    });

    // Act
    logger.debug("debug line");
    logger.info("info line");
    logger.warn({ err, res: { statusCode: 502 } }, "warn line");
    logger.error({ err }, "error line");
    logger.fatal("fatal line");
    await Sentry.flush(1000);

    // Assert
    expect(items("log")).toEqual([]);
    expect(items("event")).toEqual([]);
    expect(sentText()).not.toContain(" line");
  });
});

describe("outgoing calls", () => {
  const servers = new LoopbackServers();

  afterEach(async () => {
    await servers.closeAll();
  });

  it("carry no baggage or sentry-trace header: the data.go.kr gateway refuses a header holding environment=", async () => {
    // Arrange
    let received: IncomingHttpHeaders = {};
    const server = await servers.serve((req, res) => {
      received = req.headers;
      res.end("{}");
    });
    const { port } = server.address() as { port: number };

    // Act
    await axios.get(`http://127.0.0.1:${port}/getRestDeInfo`, { params: { solYear: "2026", _type: "json" } });

    // Assert
    expect(received.host).toBe(`127.0.0.1:${port}`);
    expect(received).not.toHaveProperty("baggage");
    expect(received).not.toHaveProperty("sentry-trace");
    expect(JSON.stringify(received)).not.toContain("environment=");
  });
});

describe("scrub helpers", () => {
  it("scrubBreadcrumb masks the url and drops the separate query", () => {
    // Act
    const b = scrubBreadcrumb({ data: { url: "/a?token=x", "http.query": "token=x" } })!;

    // Assert
    expect(b.data).toEqual({ url: "/a?token=%5BREDACTED%5D" });
  });

  it("scrubEvent leaves an event without a request alone", () => {
    // Act & Assert
    expect(scrubEvent({ message: "m" } as never)).toEqual({ message: "m" });
  });

  it("flattenLogAttributes stops at three levels", () => {
    // Act
    const out = flattenLogAttributes({
      level: "info",
      message: "m",
      attributes: { a: { b: { c: { d: 1 } } }, x: 1 },
    });

    // Assert
    expect(out.attributes).toEqual({ "a.b.c": { d: 1 }, x: 1 });
  });
});
