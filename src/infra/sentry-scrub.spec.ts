/**
 * No service key reaches Sentry through an outgoing call's URL: not in the
 * breadcrumb the SDK records for each call (`data.url`, its query already cut
 * off), and not in an event's message, exception values or breadcrumb
 * messages, where an error that quotes its request URL would carry it.
 */
import type { Breadcrumb, ErrorEvent } from "@sentry/nestjs";
import { scrubBreadcrumb, scrubEvent } from "./sentry-scrub";

const FAKE_KEY = "TESTKEY123";
const SUBWAY_URL = `http://swopenapi.seoul.go.kr/api/subway/${FAKE_KEY}/json/realtimeStationArrival/0/50/x`;
const MASKED_SUBWAY_URL = "http://swopenapi.seoul.go.kr/api/subway/[REDACTED]/json/realtimeStationArrival/0/50/x";

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
