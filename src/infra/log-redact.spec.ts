/**
 * What `maskUrl` keeps of an outbound or inbound URL before it is logged or
 * sent to Sentry: no service key, wherever the upstream wants it. A query key
 * is caught by its parameter name; Seoul's open APIs take the key as a path
 * segment instead (`/api/subway/<key>/json/...`), which a name rule never sees.
 */
import { maskUrl } from "./log-redact";

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
