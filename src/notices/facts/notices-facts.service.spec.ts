/**
 * NoticesFactsService.parseFacts: the one place a stored `facts` value becomes a typed record or null.
 *
 * A notice with no `facts` is the normal state before extraction, so it reads as null without a log line. A value that
 * is present and fails the schema (a missing key, another `v`) reads as null too, and logs `notices.facts.unparsed`
 * with the notice id, at most once a minute per notice on the Clock so a bad record cannot flood the log.
 *
 * src/infra/logger.ts is mocked.
 */
import fs from "fs";
import path from "path";
import { ObjectId } from "mongodb";
import type { Clock } from "../../infra/clock";

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../infra/logger", () => mockLogger);

import { logText } from "../../../__tests__/helpers/log-text";
import { NOTICES_FACTS_LOG_INTERVAL_MS } from "./notices-facts.constants";
import { NoticesFactsService } from "./notices-facts.service";

const FIXTURE = path.join(__dirname, "../../../__tests__/nest/notices/fixtures/notice-facts.dev-records.json");
const FACTS = (JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as { records: Array<{ facts: Record<string, unknown> }> }).records[0]!.facts;

const NOTICE_ID = new ObjectId("6a5ed9e520097db8672d2097");
const OTHER_NOTICE_ID = new ObjectId("6a5ed9e520097db8672d2098");
const START = new Date("2026-10-28T03:00:00.000Z");

function serviceAt(clock: { instant: Date }): NoticesFactsService {
  const fixedClock: Clock = { now: () => clock.instant };
  return new NoticesFactsService(fixedClock);
}

const withoutThings = (): Record<string, unknown> => {
  const copy = { ...FACTS };
  delete copy.things;
  return copy;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("NoticesFactsService.parseFacts", () => {
  it("returns a stored record as parsed, and logs nothing", () => {
    // Arrange
    const service = serviceAt({ instant: START });

    // Act
    const facts = service.parseFacts(FACTS, NOTICE_ID);

    // Assert
    expect(facts).toEqual(FACTS);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it.each([
    ["a notice with no facts field", undefined],
    ["a notice whose facts are null", null],
  ])("returns null for %s, and logs nothing", (_label, stored) => {
    // Arrange
    const service = serviceAt({ instant: START });

    // Act
    const facts = service.parseFacts(stored, NOTICE_ID);

    // Assert
    expect(facts).toBeNull();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it.each([
    ["a record missing a required key", withoutThings(), "things"],
    ["a record of another version", { ...FACTS, v: 2 }, "v"],
    ["a record with no version", { ...FACTS, v: undefined }, "v"],
    ["a value that is not an object", "facts", "(root)"],
  ])("returns null for %s, and logs the notice id and the failing path", (_label, stored, failingPath) => {
    // Arrange
    const service = serviceAt({ instant: START });

    // Act
    const facts = service.parseFacts(stored, NOTICE_ID);

    // Assert
    expect(facts).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    const [fields] = mockLogger.warn.mock.calls[0] as [Record<string, unknown>];
    expect(fields).toMatchObject({ event: "notices.facts.unparsed", noticeId: NOTICE_ID.toHexString(), suppressed: 0 });
    expect(logText(mockLogger.warn.mock.calls[0])).toContain(failingPath);
  });

  it("names the stored version of a record it refuses, so a version bump shows in the log", () => {
    // Arrange
    const service = serviceAt({ instant: START });

    // Act
    service.parseFacts({ ...FACTS, v: 2 }, NOTICE_ID);

    // Assert
    expect(mockLogger.warn.mock.calls[0]?.[0]).toMatchObject({ factsVersion: 2 });
  });

  it("logs one notice at most once an interval, counts the lines it skipped, and logs another notice at once", () => {
    // Arrange
    const clock = { instant: START };
    const service = serviceAt(clock);
    const bad = withoutThings();

    // Act
    service.parseFacts(bad, NOTICE_ID);
    service.parseFacts(bad, NOTICE_ID);
    service.parseFacts(bad, OTHER_NOTICE_ID);
    clock.instant = new Date(START.getTime() + NOTICES_FACTS_LOG_INTERVAL_MS);
    service.parseFacts(bad, NOTICE_ID);

    // Assert
    const logged = mockLogger.warn.mock.calls.map(([fields]) => fields as Record<string, unknown>);
    expect(logged.map((fields) => [fields.noticeId, fields.suppressed])).toEqual([
      [NOTICE_ID.toHexString(), 0],
      [OTHER_NOTICE_ID.toHexString(), 0],
      [NOTICE_ID.toHexString(), 1],
    ]);
  });

  it("still returns null for a notice whose line the throttle skipped", () => {
    // Arrange
    const service = serviceAt({ instant: START });
    service.parseFacts(withoutThings(), NOTICE_ID);

    // Act
    const facts = service.parseFacts(withoutThings(), NOTICE_ID);

    // Assert
    expect(facts).toBeNull();
  });
});
