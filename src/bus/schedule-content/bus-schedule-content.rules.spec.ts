/**
 * The calendar check the schedule content datasets share: a date is a real
 * day written YYYY-MM-DD, so a push cannot store a day the calendar does not
 * have, or one the strict reads would not find. And the identities a
 * `bus-service-notices` push names: each stored service id, which must be a
 * service the code defines (`busServices`, move-editorial-datasets D7).
 */
import { isCalendarDate, serviceNoticesReferences } from "./bus-schedule-content.rules";

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
