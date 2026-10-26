/**
 * No service key reaches Sentry through an outgoing call's URL: not in the
 * breadcrumb the SDK records for each call (`data.url`, its query already cut
 * off), and not in an event's message, exception values or breadcrumb
 * messages, where an error that quotes its request URL would carry it.
 * A Healthchecks.io ping URL is a credential in its path: its outgoing-call
 * breadcrumb is dropped and a quoted copy loses its path.
 */
import type { Breadcrumb, ErrorEvent } from "@sentry/nestjs";
import { scrubBreadcrumb, scrubEvent } from "./sentry-scrub";

const FAKE_KEY = "TESTKEY123";
const SUBWAY_URL = `http://swopenapi.seoul.go.kr/api/subway/${FAKE_KEY}/json/realtimeStationArrival/0/50/x`;
const MASKED_SUBWAY_URL = "http://swopenapi.seoul.go.kr/api/subway/[REDACTED]/json/realtimeStationArrival/0/50/x";
const PING_UUID = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
const PING_URL = `https://hc-ping.com/${PING_UUID}`;

describe("scrubBreadcrumb", () => {
  it("masks the key in the path of an outgoing call, as the SDK records it", () => {
    // Arrange
    const breadcrumb: Breadcrumb = {
      category: "http",
      type: "http",
      data: { status_code: 200, url: SUBWAY_URL, "http.method": "GET" },
    };

    // Act
    const out = scrubBreadcrumb(breadcrumb);

    // Assert
    expect(out?.data).toEqual({ status_code: 200, url: MASKED_SUBWAY_URL, "http.method": "GET" });
  });

  it("drops the breadcrumb of a Healthchecks.io ping, whose path is the check's credential", () => {
    // Arrange
    const breadcrumb: Breadcrumb = {
      category: "http",
      type: "http",
      data: { status_code: 200, url: PING_URL, "http.method": "GET" },
    };

    // Act
    const out = scrubBreadcrumb(breadcrumb);

    // Assert
    expect(out).toBeNull();
  });

  it("drops the breadcrumb of a ping to the host of the configured ping URL", () => {
    // Arrange
    const previous = process.env.HEALTHCHECKS_POLLER_PING_URL;
    process.env.HEALTHCHECKS_POLLER_PING_URL = `https://hc.example.test/ping/${PING_UUID}`;
    try {
      // Act
      const out = scrubBreadcrumb({ category: "http", data: { url: `https://hc.example.test/ping/${PING_UUID}` } });

      // Assert
      expect(out).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.HEALTHCHECKS_POLLER_PING_URL;
      else process.env.HEALTHCHECKS_POLLER_PING_URL = previous;
    }
  });

  it("removes the path of a ping URL quoted in the message", () => {
    // Act
    const out = scrubBreadcrumb({ category: "console", message: `GET ${PING_URL} failed` });

    // Assert
    expect(out?.message).toBe("GET https://hc-ping.com/[REDACTED] failed");
  });

  it("masks a URL quoted in the message", () => {
    // Act
    const out = scrubBreadcrumb({ category: "console", message: `GET ${SUBWAY_URL} failed` });

    // Assert
    expect(out?.message).toBe(`GET ${MASKED_SUBWAY_URL} failed`);
  });
});

describe("scrubEvent", () => {
  it("masks a URL quoted in the message and in each exception value", () => {
    // Arrange
    const event = {
      type: undefined,
      message: `fetch ${SUBWAY_URL}`,
      exception: {
        values: [
          { type: "Error", value: `request to ${SUBWAY_URL} failed` },
          { type: "Error", value: `https://apis.data.go.kr/x?serviceKey=${FAKE_KEY}&solYear=2026 timed out` },
          { type: "Error" },
        ],
      },
      breadcrumbs: [{ category: "http", data: { url: SUBWAY_URL } }],
    } as ErrorEvent;

    // Act
    const out = scrubEvent(event);

    // Assert
    expect(JSON.stringify(out)).not.toContain(FAKE_KEY);
    expect(out.message).toBe(`fetch ${MASKED_SUBWAY_URL}`);
    expect(out.exception?.values).toEqual([
      { type: "Error", value: `request to ${MASKED_SUBWAY_URL} failed` },
      { type: "Error", value: "https://apis.data.go.kr/x?serviceKey=%5BREDACTED%5D&solYear=2026 timed out" },
      { type: "Error" },
    ]);
  });

  it("drops a Healthchecks.io ping breadcrumb and keeps the others", () => {
    // Arrange
    const event = {
      type: undefined,
      breadcrumbs: [
        { category: "http", data: { url: PING_URL } },
        { category: "http", data: { url: "https://example.test/x" } },
      ],
    } as ErrorEvent;

    // Act
    const out = scrubEvent(event);

    // Assert
    expect(JSON.stringify(out)).not.toContain(PING_UUID);
    expect(out.breadcrumbs).toEqual([{ category: "http", data: { url: "https://example.test/x" } }]);
  });

  it("leaves text without a URL alone", () => {
    // Arrange
    const event = { type: undefined, message: "realtimePosition: HTTP 500", exception: { values: [{ value: "kaboom" }] } } as ErrorEvent;

    // Act
    const out = scrubEvent(event);

    // Assert
    expect(out.message).toBe("realtimePosition: HTTP 500");
    expect(out.exception?.values).toEqual([{ value: "kaboom" }]);
  });
});
