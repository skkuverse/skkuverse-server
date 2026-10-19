/**
 * The calendar check the schedule content datasets share: a date is a real
 * day written YYYY-MM-DD, so a push cannot store a day the calendar does not
 * have, or one the strict reads would not find. And the identities a
 * `bus-service-notices` push names: each stored service id, which must be a
 * service the code defines (`busServices`, move-editorial-datasets D7).
 */
import { isCalendarDate, isRestDayKey, serviceNoticesReferences, toRestDays } from "./bus-schedule-content.rules";

describe("isCalendarDate", () => {
  it.each([
    ["2026-12-21", true],
    ["2028-02-29", true],
    ["2027-02-29", false],
    ["2026-02-28", true],
    ["2026-12-31", true],
    ["2026-12-32", false],
    ["2026-13-01", false],
    ["2026-00-10", false],
    ["2026-12-1", false],
    ["26-12-21", false],
    ["2026-12-21T00:00", false],
    ["", false],
  ])("%j is a calendar date: %s", (value, expected) => {
    // Act & Assert
    expect(isCalendarDate(value)).toBe(expected);
  });
});

describe("serviceNoticesReferences", () => {
  it("names each stored service as a busServices reference at its path, in stored order", () => {
    // Arrange
    const data = {
      services: {
        "campus-inja": { notices: [], suspend: null },
        "campus-jaja": { notices: [{ style: "info" as const, text: "공지" }], suspend: null },
      },
    };

    // Act
    const references = serviceNoticesReferences(data);

    // Assert
    expect(references).toEqual([
      { dataset: "busServices", id: "campus-inja", path: ["services", "campus-inja"] },
      { dataset: "busServices", id: "campus-jaja", path: ["services", "campus-jaja"] },
    ]);
  });

  it("names nothing for no stored service", () => {
    // Act & Assert
    expect(serviceNoticesReferences({ services: {} })).toEqual([]);
  });
});

describe("isRestDayKey", () => {
  it.each([
    ["09-28", true],
    ["02-29", true],
    ["02-30", false],
    ["13-01", false],
    ["00-01", false],
    ["2027-03-02", true],
    ["2027-02-29", false],
    ["2028-02-29", true],
    ["1899-12-31", false],
    ["1900-01-01", true],
    ["2999-12-31", true],
    ["3000-01-01", false],
    ["_comment", false],
    ["9-28", false],
    ["2027-3-02", false],
  ])("%j is a rest day key: %s", (key, expected) => {
    // Act & Assert
    expect(isRestDayKey(key)).toBe(expected);
  });
});

describe("toRestDays", () => {
  it("files each MM-DD key as yearly and each YYYY-MM-DD key as one-off, with its label", () => {
    // Act
    const restDays = toRestDays({ "09-28": "공자탄신일", "2027-03-02": "학사휴교", "09-25": "건학기념일" });

    // Assert
    expect(restDays).toEqual({
      exact: new Map([["2027-03-02", "학사휴교"]]),
      annual: new Map([["09-28", "공자탄신일"], ["09-25", "건학기념일"]]),
    });
  });

  it("answers no rest day for none", () => {
    // Act & Assert
    expect(toRestDays({})).toEqual({ exact: new Map(), annual: new Map() });
  });
});
