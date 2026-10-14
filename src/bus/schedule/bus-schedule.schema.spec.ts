/**
 * The timetable document schemas: a document as the scripts write it passes, a
 * copy missing any required field fails, and entries and notices pass through
 * as the same objects. restDaysFile refuses a key that is neither a date nor a
 * month-day, and a label that is not a non-empty string.
 */
import { busOverrideDoc, busScheduleDoc, restDaysFile } from "./bus-schedule.schema";

const PATTERN = { serviceId: "campus-inja", patternId: "weekday", days: [1, 2], entries: [{ time: "08:00" }] };
const OVERRIDE = { serviceId: "campus-inja", date: "2026-10-21", type: "replace", label: null, notices: [{ style: "info", text: "x" }], entries: [] };

describe("busScheduleDoc", () => {
  it("accepts a pattern as the scripts write it, keeping each entry object", () => {
    // Act
    const parsed = busScheduleDoc.parse(PATTERN);

    // Assert
    expect(parsed).toEqual(PATTERN);
    expect(parsed.entries[0]).toBe(PATTERN.entries[0]);
  });

  it.each(["serviceId", "patternId", "days", "entries"])("rejects a pattern without %s", (field) => {
    // Arrange
    const copy = Object.fromEntries(Object.entries(PATTERN).filter(([key]) => key !== field));

    // Act & Assert
    expect(busScheduleDoc.safeParse(copy).success).toBe(false);
  });
});

describe("busOverrideDoc", () => {
  it("accepts an override, keeping each notice object", () => {
    // Act
    const parsed = busOverrideDoc.parse(OVERRIDE);

    // Assert
    expect(parsed.notices[0]).toBe(OVERRIDE.notices[0]);
  });

  it.each(["serviceId", "date", "type", "entries", "notices"])("rejects an override without %s", (field) => {
    // Arrange
    const copy = Object.fromEntries(Object.entries(OVERRIDE).filter(([key]) => key !== field));

    // Act & Assert
    expect(busOverrideDoc.safeParse(copy).success).toBe(false);
  });
});

describe("restDaysFile", () => {
  it.each([
    [{ _comment: "docs", "09-28": "공자탄신일", "2030-09-28": "특별" }, true],
    [{ "2026-9-28": "공자탄신일" }, false],
    [{ "09-28": "" }, false],
    [{ "09-28": true }, false],
  ])("%j → %s", (raw, expected) => {
    // Act & Assert
    expect(restDaysFile.safeParse(raw).success).toBe(expected);
  });
});
