/**
 * The menu rules: a menu's `_id` is the crawler's key, every cafeteria × meal
 * code of a date is asked for, a date's weekday is the calendar's whatever the
 * process time zone, a junk or closed cell is not served, an item with a
 * weekday restriction is served only on those weekdays, a corner left without
 * items shows only when it needs review, and meals rank B, L, D, S, R.
 */
import type { MenuCell, MenuItem } from "./meals-menus.document";
import { isServedCell, isServedOn, isShownCorner, toMealRank, toMenuId, toMenuIds, toWeekday } from "./meals-menus.rules";

const ITEM: MenuItem = { name: "카레돈가스", priceKrw: 6500, kind: "single", dishes: [], quantity: null, options: [], tags: [], days: [] };
const CELL: MenuCell = {
  name: "가츠엔",
  floor: "1F",
  items: [ITEM],
  rawText: "카레돈가스 6,500",
  likes: 0,
  imageUrl: null,
  isFixedMenu: false,
  parseStatus: "ok",
  needsReview: false,
};

describe("toMenuId", () => {
  it("joins the conspaceCd, the date and the meal code as the crawler keys a document", () => {
    // Act & Assert
    expect(toMenuId("10201031", "2026-10-14", "L")).toBe("10201031:2026-10-14:L");
  });
});

describe("toMenuIds", () => {
  it("names every meal code of the date for each cafeteria, in order", () => {
    // Act
    const ids = toMenuIds(["10201030", "10201031"], "2026-10-14");

    // Assert
    expect(ids).toEqual([
      "10201030:2026-10-14:B",
      "10201030:2026-10-14:L",
      "10201030:2026-10-14:D",
      "10201030:2026-10-14:S",
      "10201030:2026-10-14:R",
      "10201031:2026-10-14:B",
      "10201031:2026-10-14:L",
      "10201031:2026-10-14:D",
      "10201031:2026-10-14:S",
      "10201031:2026-10-14:R",
    ]);
  });

  it("names none without a cafeteria", () => {
    // Act & Assert
    expect(toMenuIds([], "2026-10-14")).toEqual([]);
  });
});

describe("toWeekday", () => {
  it.each([
    ["2026-10-12", "mon"],
    ["2026-10-14", "wed"],
    ["2026-10-17", "sat"],
    ["2026-10-18", "sun"],
    ["2026-10-19", "mon"],
  ])("reads %s as %s", (date, weekday) => {
    // Act & Assert
    expect(toWeekday(date)).toBe(weekday);
  });

  it("throws on a string that is no calendar date rather than guess a weekday", () => {
    // Act & Assert
    expect(() => toWeekday("2026-02-30")).toThrow("not a calendar date: 2026-02-30");
  });
});

describe("isServedCell", () => {
  it.each([
    ["ok", true],
    ["partial", true],
    ["raw", true],
    ["closed", false],
    ["junk", false],
  ] as const)("serves a %s cell: %s", (parseStatus, served) => {
    // Act & Assert
    expect(isServedCell({ ...CELL, parseStatus })).toBe(served);
  });
});

describe("isServedOn", () => {
  it.each([
    ["no weekday restriction", [], true],
    ["its weekday", ["wed"], true],
    ["one of its weekdays", ["mon", "wed"], true],
    ["another weekday", ["thu"], false],
  ] as const)("serves an item with %s on a Wednesday: %s", (_case, days, served) => {
    // Act & Assert
    expect(isServedOn({ ...ITEM, days: [...days] }, "wed")).toBe(served);
  });
});

describe("isShownCorner", () => {
  it.each([
    [0, false, false],
    [0, true, true],
    [1, false, true],
    [1, true, true],
  ])("shows a corner of %i items, needsReview %s: %s", (itemCount, needsReview, shown) => {
    // Act & Assert
    expect(isShownCorner(itemCount, needsReview)).toBe(shown);
  });
});

describe("toMealRank", () => {
  it("ranks breakfast, lunch, dinner, snack, then reservation", () => {
    // Act
    const ranked = (["R", "D", "B", "S", "L"] as const).slice().sort((a, b) => toMealRank(a) - toMealRank(b));

    // Assert
    expect(ranked).toEqual(["B", "L", "D", "S", "R"]);
  });
});
