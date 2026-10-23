/**
 * The shape of the `skku-rest-days` dataset.
 * `skkuRestDaysDataset`: SKKU's rest days, each key a calendar month-day
 * (one a leap year has) or a calendar date from 1900 to 2999, each label
 * non-empty, read as `RestDays`.
 * `storedRestDays`: its stored envelope.
 */
import fs from "fs";
import path from "path";
import { skkuRestDaysDataset, storedRestDays } from "./calendar.schema";

const REST_DAYS_FIXTURE = path.join(__dirname, "../../__tests__/nest/calendar/fixtures/skku-rest-days.dataset.json");

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

  it.each(["02-30", "13-01", "00-10", "2027-02-30", "2027-02-29", "1899-12-31", "3000-01-01", "_comment", "_about", "2-28", "2027-3-02", "2026-9-28", "0928", "", "09-28 "])(
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
