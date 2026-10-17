/**
 * toDailyMeals: a campus's cafeterias, in the order given, each with the
 * meals the crawler wrote for the date. What it guards: a cafeteria with no
 * menu serves `meals: []`; meals come in B, L, D, S, R order and only with a
 * corner left; junk and closed cells are dropped; an item restricted to other
 * weekdays is dropped, and a corner it empties is dropped unless it needs
 * review; an option without a price is dropped; each item and corner serves
 * only the wire's fields; the building serves its skkuId and name.
 */
import type { CafeteriaList } from "../catalog/meals-catalog.wire";
import type { MenuCell, MenuDoc, MenuItem } from "./meals-menus.document";
import { toDailyMeals } from "./meals-menus.mapper";

const WEDNESDAY = "2026-10-14";

const CAFETERIAS: CafeteriaList = {
  cafeterias: [
    {
      id: "20201104",
      campus: "nsc",
      name: { ko: "행단골식당", en: "Haengdangol" },
      building: { skkuId: 15, buildNo: "203", displayNo: "3", name: { ko: "학생회관", en: "Student Center" } },
      floor: { ko: "1층", en: "1F" },
      spaceCd: null,
      location: null,
    },
    { id: "20201252", campus: "nsc", name: { ko: "기숙사식당", en: "Dormitory" }, building: null, floor: null, spaceCd: null, location: null },
  ],
};

const ITEM: MenuItem = { name: "등심돈가스", priceKrw: 5500, kind: "single", dishes: [], quantity: null, options: [], tags: [], days: [] };
const CELL: MenuCell = {
  name: "가츠엔",
  floor: "1F",
  items: [ITEM],
  rawText: "등심돈가스(5.5)",
  likes: 3,
  imageUrl: null,
  isFixedMenu: true,
  parseStatus: "ok",
  needsReview: false,
};

function menu(meal: MenuDoc["meal"], cells: MenuCell[], cafeteriaId = "20201104"): MenuDoc {
  return { _id: `${cafeteriaId}:${WEDNESDAY}:${meal}`, cafeteriaId, date: WEDNESDAY, meal, cells };
}

const mealsOf = (menus: MenuDoc[]) => toDailyMeals({ campus: "nsc", date: WEDNESDAY }, CAFETERIAS, menus).cafeterias[0]!.meals;

describe("toDailyMeals", () => {
  it("serves every cafeteria in the order given, with its building's id and name, and meals: [] without a menu", () => {
    // Act
    const daily = toDailyMeals({ campus: "nsc", date: WEDNESDAY }, CAFETERIAS, [menu("L", [CELL])]);

    // Assert
    expect(daily).toEqual({
      date: WEDNESDAY,
      campus: "nsc",
      cafeterias: [
        {
          id: "20201104",
          name: { ko: "행단골식당", en: "Haengdangol" },
          building: { skkuId: 15, name: { ko: "학생회관", en: "Student Center" } },
          floor: { ko: "1층", en: "1F" },
          meals: [
            {
              code: "L",
              corners: [
                {
                  name: "가츠엔",
                  floor: "1F",
                  isFixedMenu: true,
                  likes: 3,
                  imageUrl: null,
                  items: [{ name: "등심돈가스", priceKrw: 5500, kind: "single", dishes: [], quantity: null, options: [], tags: [] }],
                  needsReview: false,
                  rawText: "등심돈가스(5.5)",
                },
              ],
            },
          ],
        },
        { id: "20201252", name: { ko: "기숙사식당", en: "Dormitory" }, building: null, floor: null, meals: [] },
      ],
    });
  });

  it("orders meals B, L, D, S, R whatever order they are read in", () => {
    // Act
    const meals = mealsOf([menu("R", [CELL]), menu("D", [CELL]), menu("B", [CELL]), menu("S", [CELL]), menu("L", [CELL])]);

    // Assert
    expect(meals.map((m) => m.code)).toEqual(["B", "L", "D", "S", "R"]);
  });

  it("drops a junk or closed cell, and a meal left with no corner", () => {
    // Act
    const meals = mealsOf([
      menu("B", []),
      menu("L", [{ ...CELL, name: "test", parseStatus: "junk" }, { ...CELL, name: "피키피커스", parseStatus: "partial", needsReview: true }]),
      menu("D", [{ ...CELL, parseStatus: "closed" }]),
    ]);

    // Assert
    expect(meals).toEqual([{ code: "L", corners: [expect.objectContaining({ name: "피키피커스", needsReview: true })] }]);
  });

  it("serves a weekday-restricted item only on its weekday", () => {
    // Arrange
    const curry: MenuItem = { ...ITEM, name: "카레돈가스", days: ["wed"] };
    const udon: MenuItem = { ...ITEM, name: "우동", days: ["thu", "fri"] };

    // Act
    const [lunch] = mealsOf([menu("L", [{ ...CELL, items: [ITEM, curry, udon] }])]);

    // Assert
    expect(lunch!.corners[0]!.items.map((i) => i.name)).toEqual(["등심돈가스", "카레돈가스"]);
  });

  it("drops a corner the weekday empties, unless it needs review, which keeps its raw text", () => {
    // Arrange
    const thursdayOnly: MenuItem = { ...ITEM, name: "우동", days: ["thu"] };

    // Act
    const [lunch] = mealsOf([
      menu("L", [
        { ...CELL, name: "가츠엔", items: [thursdayOnly] },
        { ...CELL, name: "싱푸차이나", items: [thursdayOnly], parseStatus: "partial", needsReview: true, rawText: "[목] 우동 / ???" },
        { ...CELL, name: "봄이온소반", items: [], parseStatus: "raw", needsReview: true, rawText: "원문만" },
      ]),
    ]);

    // Assert
    expect(lunch!.corners.map((c) => [c.name, c.items, c.rawText])).toEqual([
      ["싱푸차이나", [], "[목] 우동 / ???"],
      ["봄이온소반", [], "원문만"],
    ]);
  });

  it("serves a set's dishes, a quantity, tags and priced options, and drops an option without a price", () => {
    // Arrange
    const jajang: MenuItem = {
      name: "자장면",
      priceKrw: 4500,
      kind: "set",
      dishes: ["자장면", "단무지"],
      quantity: "2pcs",
      options: [
        { name: "곱빼기", extraKrw: 1000 },
        { name: "계란", extraKrw: null },
      ],
      tags: ["천원의아침밥"],
      days: [],
    };

    // Act
    const [lunch] = mealsOf([menu("L", [{ ...CELL, items: [jajang] }])]);

    // Assert
    expect(lunch!.corners[0]!.items).toEqual([
      { name: "자장면", priceKrw: 4500, kind: "set", dishes: ["자장면", "단무지"], quantity: "2pcs", options: [{ name: "곱빼기", extraKrw: 1000 }], tags: ["천원의아침밥"] },
    ]);
  });

  it("joins each menu to its own cafeteria and leaves a menu of no listed cafeteria out", () => {
    // Act
    const daily = toDailyMeals({ campus: "nsc", date: WEDNESDAY }, CAFETERIAS, [menu("L", [CELL], "20201252"), menu("D", [CELL], "99999999")]);

    // Assert
    expect(daily.cafeterias.map((c) => [c.id, c.meals.map((m) => m.code)])).toEqual([
      ["20201104", []],
      ["20201252", ["L"]],
    ]);
  });
});
