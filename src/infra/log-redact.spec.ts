/**
 * What `maskUrl` keeps of an outbound or inbound URL before it is logged or
 * sent to Sentry: no service key, wherever the upstream wants it. A query key
 * is caught by its parameter name; Seoul's open APIs take the key as a path
 * segment instead (`/api/subway/<key>/json/...`), which a name rule never sees.
 * What `serializeError` keeps of an upstream failure: the upstream, the code it
 * answered with and the kind of failure, so the log line alone tells an outage
 * from a refused key or a spent quota.
 */
import { maskUrl, serializeError } from "./log-redact";
import { UpstreamError } from "./upstream.error";

const FAKE_KEY = "TESTKEY123";

describe("maskUrl", () => {
  it.each([
    [
      "the Seoul subway API",
      `http://swopenapi.seoul.go.kr/api/subway/${FAKE_KEY}/json/realtimePosition/0/400/2%ED%98%B8%EC%84%A0`,
      "http://swopenapi.seoul.go.kr/api/subway/[REDACTED]/json/realtimePosition/0/400/2%ED%98%B8%EC%84%A0",
    ],
    [
      "Seoul open data on port 8088",
      `http://openapi.seoul.go.kr:8088/${FAKE_KEY}/xml/CardSubwayStatsNew/1/5/20261020`,
      "http://openapi.seoul.go.kr:8088/[REDACTED]/xml/CardSubwayStatsNew/1/5/20261020",
    ],
  ])("masks the key %s takes in its path", (_name, url, masked) => {
    // Act
    const out = maskUrl(url);

    // Assert
    expect(out).toBe(masked);
    expect(out).not.toContain(FAKE_KEY);
  });

  it("leaves the path of any other host alone, response-type segment or not", () => {
    // Arrange
    const url = "https://api.skkuverse.com/subway/stations/json/1";

    // Act & Assert
    expect(maskUrl(url)).toBe(url);
  });

  it.each(["serviceKey", "key", "KEY", "apiKey", "appKey", "access_token", "client_secret"])(
    "masks the query parameter %s",
    (name) => {
      // Act
      const out = maskUrl(`https://apis.data.go.kr/x/getRestDeInfo?${name}=${FAKE_KEY}&solYear=2026`);

      // Assert
      expect(out).toBe(`https://apis.data.go.kr/x/getRestDeInfo?${name}=%5BREDACTED%5D&solYear=2026`);
    },
  );

  it("masks the path key of a relative Seoul URL only when it names the host", () => {
    // Arrange
    const relative = `/api/subway/${FAKE_KEY}/json/realtimePosition/0/400/x`;

    // Act & Assert
    expect(maskUrl(relative)).toBe(relative);
  });
});

describe("serializeError", () => {
  it("logs an upstream failure's kind and fields beside the upstream", () => {
    // Arrange
    const err = new UpstreamError("example auth (list, 401, unknown key)", "example", { failure: { kind: "auth", status: 401, message: "unknown key" } });

    // Act
    const logged = serializeError(err);

    // Assert
    expect(logged).toMatchObject({ type: "UpstreamError", message: "example auth (list, 401, unknown key)", upstream: "example", failure: { kind: "auth", status: 401, message: "unknown key" } });
  });

  it("logs the code and message an upstream answered with", () => {
    // Arrange
    const err = new UpstreamError("example error code (list)", "example", { headerCd: "7", headerMsg: "refused" });

    // Act
    const logged = serializeError(err);

    // Assert
    expect(logged).toMatchObject({ upstream: "example", headerCd: "7", headerMsg: "refused" });
    expect(logged).not.toHaveProperty("failure.kind");
  });
});
