/**
 * The school rest days of the `skku-rest-days` dataset: which keys a push may
 * store (a calendar month-day a leap year has, recurring yearly, or a calendar
 * date from 1900 to 2999, applying once), how the keys are filed, and which
 * label a date gets (an exact date before the yearly rule).
 */
import { isRestDayKey, lookupRestDay, toRestDays } from "./calendar.rules";
import type { RestDays } from "./calendar.types";

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

describe("lookupRestDay", () => {
  it("prefers an exact date over the annual rule", () => {
    // Arrange
    const days: RestDays = { exact: new Map([["2030-09-28", "공자탄신일 (특별)"]]), annual: new Map([["09-28", "공자탄신일"]]) };

    // Act & Assert
    expect(lookupRestDay(days, "2030-09-28")).toBe("공자탄신일 (특별)");
    expect(lookupRestDay(days, "2031-09-28")).toBe("공자탄신일");
    expect(lookupRestDay(days, "2031-09-27")).toBeNull();
  });
});
