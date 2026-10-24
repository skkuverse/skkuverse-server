/**
 * MealsMenusService over building's in-memory repositories (through
 * MealsCatalogService) and an in-memory menus repository. What it guards: no
 * date means today in KST, not in UTC; the menus asked for are the campus's
 * cafeterias' on that date; and a failed menus read rejects rather than
 * serving cafeterias without menus.
 */
import { FakeBuildingCafeteriaListRepository } from "../../../__tests__/helpers/fakes/building/building-cafeteria-list.repository.fake";
import { FakeBuildingRepository } from "../../../__tests__/helpers/fakes/building/building.repository.fake";
import { FakeMealsMenusRepository } from "../../../__tests__/helpers/fakes/meals/meals-menus.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { BuildingService } from "../../building/building.service";
import type { CafeteriaDoc } from "../../building/building.document";
import { BuildingCafeteriaListService } from "../../building/cafeteria-list/building-cafeteria-list.service";
import type { Clock } from "../../infra/clock";
import { MealsCatalogService } from "../catalog/meals-catalog.service";
import { MealsMenusService } from "./meals-menus.service";

// WHY: 01:30 KST on Monday the 19th is still Sunday the 18th in UTC, and Sunday has no menu.
const MONDAY_IN_KST = new Date("2026-10-18T16:30:00Z");

function cafeteria(id: string, campus: "hssc" | "nsc"): CafeteriaDoc {
  return { _id: id, kind: "cafeteria", campus, name: { ko: id, en: id }, buildNo: "101", floor: null, spaceCd: null, location: null } as CafeteriaDoc;
}

function lunch(cafeteriaId: string, date: string, corner: string): Record<string, unknown> {
  const cell = { name: corner, floor: null, items: [], rawText: corner, likes: null, imageUrl: null, isFixedMenu: false, parseStatus: "raw", needsReview: true };
  return { _id: `${cafeteriaId}:${date}:L`, cafeteriaId, date, meal: "L", cells: [cell] };
}

let cafeterias: FakeBuildingCafeteriaListRepository;
let menus: FakeMealsMenusRepository;
let service: MealsMenusService;

beforeEach(() => {
  cafeterias = new FakeBuildingCafeteriaListRepository();
  menus = new FakeMealsMenusRepository();
  const catalog = new MealsCatalogService(
    new BuildingCafeteriaListService(asReal<ConstructorParameters<typeof BuildingCafeteriaListService>[0]>(cafeterias)),
    new BuildingService(asReal<ConstructorParameters<typeof BuildingService>[0]>(new FakeBuildingRepository())),
  );
  const clock: Clock = { now: () => MONDAY_IN_KST };
  service = new MealsMenusService(catalog, asReal<ConstructorParameters<typeof MealsMenusService>[1]>(menus), clock);
  cafeterias.cafeterias = [cafeteria("10201031", "hssc"), cafeteria("20201104", "nsc")];
});

describe("MealsMenusService.listDailyMeals", () => {
  it("serves today in KST when no date is given, not the UTC date", async () => {
    // Arrange
    menus.documents = [lunch("10201031", "2026-10-18", "일요일"), lunch("10201031", "2026-10-19", "월요일")];

    // Act
    const daily = await service.listDailyMeals("hssc", undefined);

    // Assert
    expect(daily.date).toBe("2026-10-19");
    expect(daily.date).not.toBe(MONDAY_IN_KST.toISOString().slice(0, 10));
    expect(daily.cafeterias[0]!.meals[0]!.corners.map((c) => c.name)).toEqual(["월요일"]);
  });

  it("serves the date asked for, only for the campus's cafeterias", async () => {
    // Arrange
    menus.documents = [lunch("10201031", "2026-10-14", "은행골"), lunch("20201104", "2026-10-14", "행단골"), lunch("10201031", "2026-10-15", "목요일")];

    // Act
    const daily = await service.listDailyMeals("hssc", "2026-10-14");

    // Assert
    expect(daily.date).toBe("2026-10-14");
    expect(daily.campus).toBe("hssc");
    expect(daily.cafeterias.map((c) => [c.id, c.meals.flatMap((m) => m.corners.map((k) => k.name))])).toEqual([["10201031", ["은행골"]]]);
  });

  it("rejects when the menus cannot be read", async () => {
    // Arrange
    menus.failWith = new Error("mongo down");

    // Act & Assert
    await expect(service.listDailyMeals("nsc", "2026-10-14")).rejects.toThrow("mongo down");
  });
});
