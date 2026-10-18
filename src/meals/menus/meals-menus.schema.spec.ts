/**
 * The menus schemas. dailyMealsQuery: campus is required as for
 * /meals/cafeterias, and date is optional but, when given, a real calendar
 * date in `YYYY-MM-DD`. menuDoc: every document the crawler wrote for
 * 2026-10-14 passes, fields this server does not read are dropped, and a copy
 * missing any field it reads, or with a meal code or parse status the server
 * does not know, fails.
 */
import fixture from "../../../__tests__/nest/meals/fixtures/crawler-meal-docs-2026-10-14.json";
import { dailyMealsQuery, menuDoc } from "./meals-menus.schema";

const DOCUMENTS = fixture.documents as Array<Record<string, unknown>>;
const DOCUMENT = DOCUMENTS.find((doc) => doc._id === "20201104:2026-10-14:L")!;

describe("dailyMealsQuery", () => {
  it("takes a campus with or without a date", () => {
    // Act & Assert
    expect(dailyMealsQuery.parse({ campus: "nsc", date: "2026-10-14" })).toEqual({ campus: "nsc", date: "2026-10-14" });
    expect(dailyMealsQuery.parse({ campus: "hssc" })).toEqual({ campus: "hssc" });
  });

  it.each([
    ["a leap day", "2028-02-29"],
    ["the last day of a year", "2026-12-31"],
  ])("takes %s", (_case, date) => {
    // Act & Assert
    expect(dailyMealsQuery.safeParse({ campus: "hssc", date }).success).toBe(true);
  });

  it.each<[string, unknown]>([
    ["an empty date", ""],
    ["a date without leading zeros", "2026-1-5"],
    ["a date with a time", "2026-10-14T00:00:00Z"],
    ["an impossible day", "2026-02-30"],
    ["a non-leap February 29th", "2026-02-29"],
    ["a thirteenth month", "2026-13-01"],
    ["a word", "today"],
    ["a repeated date", ["2026-10-14", "2026-10-15"]],
  ])("rejects %s", (_case, date) => {
    // Act
    const parsed = dailyMealsQuery.safeParse({ campus: "hssc", date });

    // Assert
    expect(parsed.error?.issues).toEqual([expect.objectContaining({ path: ["date"], message: "date must be a calendar date, YYYY-MM-DD" })]);
  });

  it("rejects a missing campus first, as the campus is checked before the date", () => {
    // Act
    const parsed = dailyMealsQuery.safeParse({ date: "nope" });

    // Assert
    expect(parsed.error?.issues[0]).toEqual(expect.objectContaining({ path: ["campus"], message: "campus must be 'hssc' or 'nsc'" }));
  });
});

describe("menuDoc", () => {
  it.each(DOCUMENTS.map((doc) => [doc._id, doc] as const))("accepts the crawler's %s", (_id, doc) => {
    // Act & Assert
    expect(menuDoc.safeParse(doc).success).toBe(true);
  });

  it("keeps the fields the menus read and drops the rest", () => {
    // Act
    const parsed = menuDoc.parse(DOCUMENT);

    // Assert
    expect(Object.keys(parsed)).toEqual(["_id", "cafeteriaId", "date", "meal", "cells"]);
    expect(Object.keys(parsed.cells[0]!)).toEqual(["name", "floor", "items", "rawText", "likes", "imageUrl", "isFixedMenu", "parseStatus", "needsReview"]);
    expect(parsed.cells[0]!.items[2]).toEqual({
      name: "카레돈가스",
      priceKrw: 6500,
      kind: "single",
      dishes: [],
      quantity: null,
      options: [],
      tags: [],
      days: ["wed"],
    });
  });

  it.each(Object.keys(menuDoc.shape))("rejects a document without %s", (field) => {
    // Arrange
    const copy = Object.fromEntries(Object.entries(DOCUMENT).filter(([key]) => key !== field));

    // Act & Assert
    expect(menuDoc.safeParse(copy).success).toBe(false);
  });

  it.each([
    ["an unknown meal code", { meal: "X" }],
    ["an unknown parse status", { cells: [{ ...(DOCUMENT.cells as object[])[0], parseStatus: "maybe" }] }],
    ["an unknown weekday", { cells: [{ ...(DOCUMENT.cells as object[])[0], items: [{ ...((DOCUMENT.cells as Array<{ items: object[] }>)[0]!.items[0]), days: ["wednesday"] }] }] }],
  ])("rejects %s", (_case, change) => {
    // Act & Assert
    expect(menuDoc.safeParse({ ...DOCUMENT, ...change }).success).toBe(false);
  });
});
