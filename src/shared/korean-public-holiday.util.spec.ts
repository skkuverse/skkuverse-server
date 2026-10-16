/**
 * lookupKoreanPublicHoliday, a KST date's Korean public-holiday name or null:
 * only date-holidays' `public` type counts, the date resolves at noon KST, and
 * a date the library cannot take throws a RangeError before it is asked.
 *
 * The real KR calendar answers, through a stand-in that throws where the real
 * library would hang (an Invalid Date, a year outside 1900–2999): a broken
 * guard then fails these tests instead of blocking the run.
 */
jest.mock("date-holidays", () => {
  const actual = jest.requireActual("date-holidays");
  const RealHolidays = actual.default ?? actual;
  return jest.fn().mockImplementation((...args: unknown[]) => {
    const real = new RealHolidays(...args);
    return {
      isHoliday: (date: Date) => {
        const year = date.getUTCFullYear();
        if (Number.isNaN(date.getTime()) || year < 1900 || year > 2999) throw new Error(`date-holidays would hang on ${String(date)}`);
        return real.isHoliday(date);
      },
    };
  });
});

import { lookupKoreanPublicHoliday } from "./korean-public-holiday.util";

describe("lookupKoreanPublicHoliday", () => {
  it.each([
    ["2026-01-01", "신정"],
    ["2026-10-09", "한글날"],
    ["2026-07-17", "제헌절"],
    ["2026-03-03", null],
  ])("%s → %s", (date, name) => {
    // Act & Assert
    expect(lookupKoreanPublicHoliday(date)).toBe(name);
  });

  it("ignores a holiday of another type: 제헌절 was an observance until 2025", () => {
    // Act & Assert
    expect(lookupKoreanPublicHoliday("2025-07-17")).toBeNull();
  });

  it("answers for the KST day itself, not the day before or after", () => {
    // Act & Assert
    expect(lookupKoreanPublicHoliday("2026-10-08")).toBeNull();
    expect(lookupKoreanPublicHoliday("2026-10-09")).toBe("한글날");
    expect(lookupKoreanPublicHoliday("2026-10-10")).toBeNull();
  });

  // date-holidays has a KR substitute-holiday rule since 3.37.0 (checked 2026-10-16): the Monday after
  // Independence Movement Day on a Sunday is a holiday of its own.
  it("names a substitute holiday (대체공휴일 2026-03-02)", () => {
    // Act & Assert
    expect(lookupKoreanPublicHoliday("2026-03-01")).toBe("3·1절");
    expect(lookupKoreanPublicHoliday("2026-03-02")).toBe("3·1절 (대체공휴일)");
  });

  it.each([
    ["2024-05-06", "어린이날 (대체공휴일)"],
    ["2025-10-08", "추석 (대체공휴일)"],
  ])("names the substitute holiday on %s", (date, name) => {
    // Act & Assert
    expect(lookupKoreanPublicHoliday(date)).toBe(name);
  });
});

describe("lookupKoreanPublicHoliday on a date the holiday lookup cannot take", () => {
  it.each(["2026-13-01", "2026-02-31", "2026-02-29", "2026-04-31", "0000-01-03", "0001-01-01", "1899-12-31", "3000-01-01", "10000-01-01", "2026-1-01", "Invalid date"])(
    "throws on %s",
    (date) => {
      // Act & Assert
      expect(() => lookupKoreanPublicHoliday(date)).toThrow(new RangeError(`${date} is not a date from 1900 to 2999`));
    },
  );

  it.each([
    ["1900-01-01", "신정"],
    ["2999-12-31", null],
    ["2028-02-29", null],
  ])("answers %s", (date, name) => {
    // Act & Assert
    expect(lookupKoreanPublicHoliday(date)).toBe(name);
  });
});
