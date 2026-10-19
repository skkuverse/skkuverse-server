/**
 * The timetable document schemas: a document as the scripts write it passes, a
 * copy missing any required field fails, and entries and notices pass through
 * as the same objects.
 */
import { busOverrideDoc, busScheduleDoc, weekQuery } from "./bus-schedule.schema";

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

// WHY: only a replace override serves entries; a noService one written without them must still close the day,
// and a type that is neither must not be read as a closure.
describe("busOverrideDoc by type", () => {
  const NO_SERVICE = { serviceId: "campus-inja", date: "2026-10-01", type: "noService", label: "축제", notices: [] };

  it("accepts a noService override without entries", () => {
    // Act & Assert
    expect(busOverrideDoc.safeParse(NO_SERVICE).success).toBe(true);
  });

  it("rejects a replace override without entries", () => {
    // Act & Assert
    expect(busOverrideDoc.safeParse({ ...NO_SERVICE, type: "replace" }).success).toBe(false);
  });

  it.each(["noservice", "Replace", "closed", ""])("rejects the type %j", (type) => {
    // Act & Assert
    expect(busOverrideDoc.safeParse({ ...OVERRIDE, type }).success).toBe(false);
  });
});

describe("weekQuery", () => {
  it.each([
    [{}, true],
    [{ from: "2026-03-09" }, true],
    [{ from: "bad" }, false],
    [{ from: "2026-3-9" }, false],
    [{ from: "" }, false],
    [{ from: ["2026-03-09", "2026-03-10"] }, false],
  ])("%j → %s", (query, expected) => {
    // Act & Assert
    expect(weekQuery.safeParse(query).success).toBe(expected);
  });

  it("refuses a repeated from with the date-format message", () => {
    // Act
    const result = weekQuery.safeParse({ from: ["2026-03-09", "2026-03-10"] });

    // Assert
    expect(result.error?.issues.map((issue) => issue.message)).toEqual(["from must be YYYY-MM-DD"]);
  });
});
