/**
 * The HSSC line is named by its catalog stops in a language, as the stop page
 * and the stop list head its stations: toCatalogNamedLine moved here from
 * src/bus/stop-arrivals/bus-stop-arrivals.mapper.spec.ts, its line stations
 * reduced to the name and stop id it reads. A TOPIS route's code is stated in
 * JONGRO_ROUTES (src/bus/bus.constants.spec.ts), so no mapper reads it from
 * the id any more. A stop call is served by toCall, which moved to
 * src/shared/call.util.spec.ts with ADR 0022's call.
 * A failed TOPIS request as axios rejects it, read into what came back: an
 * error answer's status and body, or the reason no answer came, a timeout
 * told apart (axios's ECONNABORTED, or ETIMEDOUT when it clarifies timeouts).
 */
import { AxiosError, type AxiosResponse } from "axios";
import { toCatalogNamedLine, toTopisAnswer } from "./bus.mapper";

describe("toCatalogNamedLine", () => {
  const station = (name: string, stopId: string | null) => ({ stopId, name });
  const line = [station("정문", "gate"), station("올림픽기념국민생활관 [하차전용]", "olympic-hall"), station("혜화동로터리 [미정차]", null)];
  const stops = [
    { id: "olympic-hall", name: { ko: "올림픽기념국민생활관", en: "Olympic Hall" } },
    { id: "gate", name: { ko: "정문", en: "Main Gate of SKKU", zh: "正门" } },
  ];

  it.each([
    ["ko", ["정문", "올림픽기념국민생활관"]],
    ["en", ["Main Gate of SKKU", "Olympic Hall"]],
    ["zh", ["正门", "Olympic Hall"]],
  ] as const)("names each stop of the line as its catalog stop in %s, English before Korean where a language is missing", (lang, expected) => {
    // Act
    const named = toCatalogNamedLine(line, stops, lang);

    // Assert
    expect(named.slice(0, 2)).toEqual([
      { name: expected[0], stopId: "gate" },
      { name: expected[1], stopId: "olympic-hall" },
    ]);
  });

  it("keeps a pass-through position, which has no stop, as the line names it", () => {
    // Act & Assert
    expect(toCatalogNamedLine(line, stops, "en")[2]).toEqual({ name: "혜화동로터리 [미정차]", stopId: null });
  });

  it("throws naming a stop id the catalog does not hold, which a push refuses", () => {
    // Act & Assert
    expect(() => toCatalogNamedLine(line, stops.slice(0, 1), "ko")).toThrow("gate");
  });
});

describe("toTopisAnswer", () => {
  const PAGE = "<html><title>503 Service Unavailable</title></html>";

  it("keeps an error answer's status and body", () => {
    // Arrange
    const err = new AxiosError("Request failed with status code 503", "ERR_BAD_RESPONSE", undefined, undefined, { status: 503, data: PAGE } as AxiosResponse);

    // Act & Assert
    expect(toTopisAnswer(err)).toEqual({ status: 503, body: PAGE });
  });

  it.each([
    ["axios's own timeout", new AxiosError("timeout of 10000ms exceeded", "ECONNABORTED"), { reason: "ECONNABORTED", timedOut: true }],
    ["a clarified timeout", new AxiosError("timeout of 10000ms exceeded", "ETIMEDOUT"), { reason: "ETIMEDOUT", timedOut: true }],
    ["a refused connection", new AxiosError("connect ECONNREFUSED 127.0.0.1:80", "ECONNREFUSED"), { reason: "ECONNREFUSED", timedOut: false }],
    ["an error with no code", new Error("Network error"), { reason: "Network error", timedOut: false }],
  ])("keeps why no answer came after %s", (_case, err, expected) => {
    // Act & Assert
    expect(toTopisAnswer(err)).toEqual(expected);
  });
});
