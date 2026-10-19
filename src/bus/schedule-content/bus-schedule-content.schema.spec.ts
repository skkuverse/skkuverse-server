/**
 * The shapes of the bus schedule content datasets (move-editorial-datasets
 * D7). `busServiceNoticesDataset`: each service's notices and suspension, as a
 * push checks them: a notice style the app draws and a non-empty text, and a
 * suspension of two calendar dates in order, each refusal at its path.
 * `storedServiceNotices`: the stored envelope the read parses.
 * `skkuRestDaysDataset` (D8): SKKU's rest days, each key a calendar month-day
 * (one a leap year has) or a calendar date from 1900 to 2999, each label
 * non-empty, read as `RestDays` (the fixture against the committed file's
 * loadRestDays is __tests__/nest/bus/bus-dataset-fixtures.test.ts's).
 * `storedRestDays`: its stored envelope.
 */
import fs from "fs";
import path from "path";
import { busServiceNoticesDataset, skkuRestDaysDataset, storedRestDays, storedServiceNotices } from "./bus-schedule-content.schema";

const NOTICES_FIXTURE = path.join(__dirname, "../../../__tests__/nest/bus/fixtures/bus-service-notices.dataset.json");

/** Revision 1 of bus-service-notices, without its provenance note. */
function fixtureNotices(): { services: Record<string, any> } {
  const dataset = JSON.parse(fs.readFileSync(NOTICES_FIXTURE, "utf8")) as Record<string, any>;
  delete dataset._about;
  return dataset as { services: Record<string, any> };
}

/** Each issue `busServiceNoticesDataset` finds in `data`, as its dotted path and message. */
function noticeIssuesOf(data: unknown): string[] {
  const parsed = busServiceNoticesDataset.safeParse(data);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join("."));
}

describe("busServiceNoticesDataset", () => {
  it("accepts revision 1 as stored, every notice in its order", () => {
    // Act
    const parsed = busServiceNoticesDataset.safeParse(fixtureNotices());

    // Assert
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(fixtureNotices());
    expect(JSON.stringify(parsed.data)).toBe(JSON.stringify(fixtureNotices()));
  });

  it.each(["info", "warning", "ai"])("accepts the %s style", (style) => {
    // Arrange
    const data = fixtureNotices();
    data.services["campus-inja"].notices = [{ style, text: "공지" }];

    // Act & Assert
    expect(noticeIssuesOf(data)).toEqual([]);
  });

  it.each([["warnig"], ["Info"], [""]])("refuses the style %j at its path", (style) => {
    // Arrange
    const data = fixtureNotices();
    data.services["campus-inja"].notices = [{ style: "info", text: "공지" }, { style, text: "공지" }];

    // Act & Assert
    expect(noticeIssuesOf(data)).toEqual(["services.campus-inja.notices.1.style"]);
  });

  it("refuses the error style, which the app reads as info, at its path", () => {
    // Arrange
    const data = fixtureNotices();
    data.services["campus-inja"].notices = [{ style: "info", text: "공지" }, { style: "error", text: "공지" }];

    // Act & Assert
    expect(noticeIssuesOf(data)).toEqual(["services.campus-inja.notices.1.style"]);
  });

  it("refuses an empty notice text at its path", () => {
    // Arrange
    const data = fixtureNotices();
    data.services["commute-dogok"].notices[1].text = "";

    // Act & Assert
    expect(noticeIssuesOf(data)).toEqual(["services.commute-dogok.notices.1.text"]);
  });

  it("refuses a notice with a field the app does not read", () => {
    // Arrange
    const data = fixtureNotices();
    data.services["campus-inja"].notices[0].source = "service";

    // Act & Assert
    expect(noticeIssuesOf(data)).toEqual(["services.campus-inja.notices.0"]);
  });

  it("accepts a suspension of two calendar dates, one day long included", () => {
    // Arrange
    const data = fixtureNotices();
    data.services["campus-inja"].suspend = { from: "2026-12-21", until: "2027-02-28" };
    data.services["campus-jain"].suspend = { from: "2028-02-29", until: "2028-02-29" };

    // Act & Assert
    expect(noticeIssuesOf(data)).toEqual([]);
  });

  it.each([
    ["from", { from: "2026-12-32", until: "2027-02-28" }],
    ["from", { from: "2026-12-1", until: "2027-02-28" }],
    ["from", { from: "bad-date", until: "2026-08-31" }],
    ["until", { from: "2026-12-21", until: "2027-02-29" }],
    ["until", { from: "2026-12-21", until: "bad-date" }],
  ])("refuses a suspension whose %s is not a calendar date", (field, suspend) => {
    // Arrange
    const data = fixtureNotices();
    data.services["campus-inja"].suspend = suspend;

    // Act & Assert
    expect(noticeIssuesOf(data)).toEqual([`services.campus-inja.suspend.${field}`]);
  });

  it("refuses a suspension whose from is after its until, at until", () => {
    // Arrange
    const data = fixtureNotices();
    data.services["campus-inja"].suspend = { from: "2026-08-31", until: "2026-06-21" };

    // Act & Assert
    expect(noticeIssuesOf(data)).toEqual(["services.campus-inja.suspend.until"]);
  });

  it.each(["notices", "suspend"])("refuses a service without %s", (field) => {
    // Arrange
    const data = fixtureNotices();
    delete data.services["campus-jain"][field];

    // Act & Assert
    expect(noticeIssuesOf(data)).toEqual([`services.campus-jain.${field}`]);
  });

  it("refuses data without services", () => {
    // Act & Assert
    expect(noticeIssuesOf({})).toEqual(["services"]);
  });
});

describe("storedServiceNotices", () => {
  const stored = (data: unknown): Record<string, unknown> => ({ revision: 3, data });

  it("reads a stored envelope's revision and services", () => {
    // Act
    const parsed = storedServiceNotices.safeParse(stored(fixtureNotices()));

    // Assert
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ revision: 3, data: fixtureNotices() });
  });

  it.each(["revision", "data"])("refuses an envelope without %s", (field) => {
    // Arrange
    const envelope = stored(fixtureNotices());
    delete envelope[field];

    // Act & Assert
    expect(storedServiceNotices.safeParse(envelope).success).toBe(false);
  });

  it.each([0, 1.5, "1"])("refuses the revision %j", (revision) => {
    // Act & Assert
    expect(storedServiceNotices.safeParse({ revision, data: fixtureNotices() }).success).toBe(false);
  });
});

const REST_DAYS_FIXTURE = path.join(__dirname, "../../../__tests__/nest/bus/fixtures/skku-rest-days.dataset.json");

/** Revision 1 of skku-rest-days, without its provenance note. */
function fixtureRestDays(): Record<string, string> {
  const dataset = JSON.parse(fs.readFileSync(REST_DAYS_FIXTURE, "utf8")) as Record<string, string>;
  delete dataset._about;
  return dataset;
}

/** Each issue `skkuRestDaysDataset` finds in `data`, as its dotted path. */
function restDayIssuesOf(data: unknown): string[] {
  const parsed = skkuRestDaysDataset.safeParse(data);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join("."));
}

describe("skkuRestDaysDataset", () => {
  it("reads revision 1 as its two yearly rest days", () => {
    // Act
    const parsed = skkuRestDaysDataset.parse(fixtureRestDays());

    // Assert
    expect(parsed).toEqual({ exact: new Map(), annual: new Map([["09-25", "건학기념일"], ["09-28", "공자탄신일"]]) });
  });

  it("reads a YYYY-MM-DD key as a one-off rest day and a MM-DD key as a yearly one", () => {
    // Act
    const parsed = skkuRestDaysDataset.parse({ "2027-03-02": "학사휴교", "09-28": "공자탄신일" });

    // Assert
    expect(parsed).toEqual({ exact: new Map([["2027-03-02", "학사휴교"]]), annual: new Map([["09-28", "공자탄신일"]]) });
  });

  it.each(["02-29", "12-31", "01-01", "2028-02-29", "1900-01-01", "2999-12-31"])("accepts the key %s", (key) => {
    // Act & Assert
    expect(restDayIssuesOf({ [key]: "휴일" })).toEqual([]);
  });

  it.each(["02-30", "13-01", "00-10", "2027-02-30", "2027-02-29", "1899-12-31", "3000-01-01", "_comment", "_about", "2-28", "2027-3-02", "0928", "", "09-28 "])(
    "refuses the key %j at its path",
    (key) => {
      // Act & Assert
      expect(restDayIssuesOf({ "09-25": "건학기념일", [key]: "휴일" })).toEqual([key]);
    },
  );

  it.each([[""], [true], [null], [3]])("refuses the label %j at its key", (label) => {
    // Act & Assert
    expect(restDayIssuesOf({ "09-25": "건학기념일", "09-28": label })).toEqual(["09-28"]);
  });

  it("accepts no rest day at all", () => {
    // Act & Assert
    expect(skkuRestDaysDataset.parse({})).toEqual({ exact: new Map(), annual: new Map() });
  });
});

describe("storedRestDays", () => {
  const stored = (data: unknown): Record<string, unknown> => ({ revision: 2, data });

  it("reads a stored envelope's revision and rest days", () => {
    // Act
    const parsed = storedRestDays.safeParse(stored(fixtureRestDays()));

    // Assert
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ revision: 2, data: skkuRestDaysDataset.parse(fixtureRestDays()) });
  });

  it.each(["revision", "data"])("refuses an envelope without %s", (field) => {
    // Arrange
    const envelope = stored(fixtureRestDays());
    delete envelope[field];

    // Act & Assert
    expect(storedRestDays.safeParse(envelope).success).toBe(false);
  });
});
