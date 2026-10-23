/**
 * The calendar's rules.
 *
 * The school rest days of the `skku-rest-days` dataset: which keys a push may
 * store (a calendar month-day a leap year has, recurring yearly, or a calendar
 * date from 1900 to 2999, applying once), how the keys are filed, and which
 * label a date gets (an exact date before the yearly rule).
 *
 * The academic year: a date's academic year (March 1 to the last day of
 * February), whether a crawled year's two semesters are usable, the default
 * rule that answers a year no valid crawled document covers, checked against
 * the semesters SKKU published for 2024 to 2026 (the crawler's captured pages,
 * __tests__/nest/calendar/fixtures/academic-calendars.json), and whether a
 * date falls in a semester or a vacation.
 */
import fs from "fs";
import path from "path";
import { lookupKoreanPublicHoliday } from "../shared/korean-public-holiday.util";
import { isRestDayKey, isSemesterPair, lookupRestDay, toAcademicPeriod, toAcademicYear, toRestDays, toRuleSemesters } from "./calendar.rules";
import type { RestDays, Semester } from "./calendar.types";

const CRAWLED = JSON.parse(fs.readFileSync(path.join(__dirname, "../../__tests__/nest/calendar/fixtures/academic-calendars.json"), "utf8")) as Record<
  string,
  { semesters: Semester[] }
>;
const isRuleHoliday = (date: string): boolean => lookupKoreanPublicHoliday(date) !== null;

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

describe("toAcademicYear", () => {
  it.each([
    ["2026-02-28", 2025],
    ["2028-02-29", 2027],
    ["2026-03-01", 2026],
    ["2026-03-02", 2026],
    ["2026-12-31", 2026],
    ["2027-01-01", 2026],
  ])("%s is in academic year %s", (date, year) => {
    // Act & Assert
    expect(toAcademicYear(date)).toBe(year);
  });
});

describe("isSemesterPair", () => {
  const TERM_1: Semester = { term: 1, start: "2026-03-02", end: "2026-06-19" };
  const TERM_2: Semester = { term: 2, start: "2026-08-31", end: "2026-12-18" };

  it.each([
    ["the published 2026 pair", [TERM_1, TERM_2], true],
    ["term 1 starting on the window's first day", [{ ...TERM_1, start: "2026-03-01" }, TERM_2], true],
    ["term 2 ending on the window's last day", [TERM_1, { ...TERM_2, end: "2027-02-28" }], true],
    ["term 1 starting before the window", [{ ...TERM_1, start: "2026-02-28" }, TERM_2], false],
    ["term 2 ending after the window", [TERM_1, { ...TERM_2, end: "2027-03-01" }], false],
    ["the terms swapped", [TERM_2, TERM_1], false],
    ["two term 1s", [TERM_1, { ...TERM_2, term: 1 }], false],
    ["one semester", [TERM_1], false],
    ["three semesters", [TERM_1, TERM_2, TERM_2], false],
    ["a term that ends before it starts", [{ ...TERM_1, end: "2026-03-01" }, TERM_2], false],
    ["a term 1 that ends on term 2's first day", [{ ...TERM_1, end: "2026-08-31" }, TERM_2], false],
    ["a term 1 that ends the day before term 2", [{ ...TERM_1, end: "2026-08-30" }, TERM_2], true],
  ] as Array<[string, Semester[], boolean]>)("%s: %s", (_label, semesters, expected) => {
    // Act & Assert
    expect(isSemesterPair(2026, semesters)).toBe(expected);
  });
});

describe("toRuleSemesters", () => {
  it.each(["2024", "2025", "2026"])("answers %s as SKKU published it, over the rule-based public holidays", (year) => {
    // Act
    const semesters = toRuleSemesters(Number(year), isRuleHoliday);

    // Assert
    expect(semesters).toEqual(CRAWLED[year]!.semesters);
  });

  it.each([
    [2024, [{ term: 1, start: "2024-03-04", end: "2024-06-21" }, { term: 2, start: "2024-09-02", end: "2024-12-20" }]],
    [2025, [{ term: 1, start: "2025-03-04", end: "2025-06-23" }, { term: 2, start: "2025-09-01", end: "2025-12-19" }]],
    [2026, [{ term: 1, start: "2026-03-02", end: "2026-06-19" }, { term: 2, start: "2026-08-31", end: "2026-12-18" }]],
  ])("answers the truth table for %s", (year, semesters) => {
    // Act & Assert
    expect(toRuleSemesters(year as number, isRuleHoliday)).toEqual(semesters);
  });

  it("opens term 1 on a weekday 03-02 even when it is a holiday, as 2026 did on its substitute holiday", () => {
    // Act
    const [termOne] = toRuleSemesters(2026, () => true);

    // Assert
    expect(termOne?.start).toBe("2026-03-02");
  });

  it("skips every holiday after a weekend 03-02, as 2025 skipped its substitute holiday", () => {
    // Act
    const [termOne] = toRuleSemesters(2025, (date) => date === "2025-03-03" || date === "2025-03-04");

    // Assert
    expect(termOne?.start).toBe("2025-03-05");
  });

  it("asks no public holiday when 03-02 is a weekday", () => {
    // Arrange
    const asked: string[] = [];

    // Act
    toRuleSemesters(2026, (date) => {
      asked.push(date);
      return false;
    });

    // Assert
    expect(asked).toEqual([]);
  });

  it.each([
    [2027, "2027-08-30"],
    [2028, "2028-09-04"],
    [2029, "2029-09-03"],
    [2030, "2030-09-02"],
    [2031, "2031-09-01"],
    [2033, "2033-08-29"],
    [2035, "2035-09-03"],
  ])("opens term 2 of %s on the Monday nearest 09-01, %s", (year, start) => {
    // Act
    const [, termTwo] = toRuleSemesters(year, () => false);

    // Assert
    expect(termTwo?.start).toBe(start);
  });

  it("ends a Tuesday-start term on the Monday before sixteen weeks have passed", () => {
    // Act
    const [termOne] = toRuleSemesters(2025, isRuleHoliday);

    // Assert
    expect(termOne).toEqual({ term: 1, start: "2025-03-04", end: "2025-06-23" });
  });
});

describe("toAcademicPeriod", () => {
  const SEMESTERS: Semester[] = [
    { term: 1, start: "2026-03-02", end: "2026-06-19" },
    { term: 2, start: "2026-08-31", end: "2026-12-18" },
  ];

  it.each([
    ["2026-03-01", "vacation", null],
    ["2026-03-02", "semester", 1],
    ["2026-06-19", "semester", 1],
    ["2026-06-20", "vacation", null],
    ["2026-08-30", "vacation", null],
    ["2026-08-31", "semester", 2],
    ["2026-12-18", "semester", 2],
    ["2026-12-19", "vacation", null],
    ["2027-02-28", "vacation", null],
  ])("%s is a %s day of term %s", (date, kind, term) => {
    // Act & Assert
    expect(toAcademicPeriod(date, SEMESTERS, "crawled")).toEqual({ kind, term, source: "crawled" });
  });

  it("carries the source it is given", () => {
    // Act & Assert
    expect(toAcademicPeriod("2026-03-02", SEMESTERS, "rule")).toEqual({ kind: "semester", term: 1, source: "rule" });
  });
});
