/**
 * MealsMenusRepository over the crawler's `meals` collection. What it guards:
 * the read asks for every cafeteria × meal code of the date by `_id` (the key
 * the crawler writes, so no index of ours is needed), with only the fields
 * the menus use and the hot-read time bound, which FakeMealsMenusRepository
 * follows; a document the crawler's shape does not fit is left out and
 * logged by `_id`; one read serves a date for the cache TTL, and a failed
 * read reaches the caller.
 */
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../infra/logger", () => mockLogger);

const toArray = jest.fn();
const find = jest.fn((..._args: unknown[]) => ({ toArray }));
const db = jest.fn(() => ({ collection: (name: string) => (name === "meals" ? { find } : {}) }));

jest.mock("../../infra/db", () => ({
  HOT_READ_MAX_TIME_MS: jest.requireActual("../../infra/db").HOT_READ_MAX_TIME_MS,
  getClient: jest.fn(() => ({ db })),
}));

import fixture from "../../../__tests__/nest/meals/fixtures/crawler-meal-docs-2026-10-14.json";
import { logText } from "../../../__tests__/helpers/log-text";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { MENU_CACHE_TTL_MS } from "./meals-menus.constants";
import { MealsMenusRepository } from "./meals-menus.repository";

const FACULTY_LUNCH = fixture.documents.find((doc) => doc._id === "10201030:2026-10-14:L")!;

let clock = 1_000_000;
let repository: MealsMenusRepository;

beforeEach(() => {
  jest.clearAllMocks();
  clock = 1_000_000;
  jest.spyOn(Date, "now").mockImplementation(() => clock);
  toArray.mockResolvedValue([FACULTY_LUNCH]);
  repository = new MealsMenusRepository();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MealsMenusRepository.listMenus", () => {
  it("reads each cafeteria's meals of the date by _id from skku_meals_test, with the fields the menus use", async () => {
    // Act
    const menus = await repository.listMenus(["10201030", "10201031"], "2026-10-14");

    // Assert
    expect(menus.map((m) => m._id)).toEqual(["10201030:2026-10-14:L"]);
    expect(db).toHaveBeenCalledWith("skku_meals_test");
    expect(find.mock.calls[0]).toEqual([
      {
        _id: {
          $in: [
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
          ],
        },
      },
      { projection: { _id: 1, cafeteriaId: 1, date: 1, meal: 1, cells: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS },
    ]);
  });

  it("leaves out a document the crawler's shape does not fit and logs it by _id", async () => {
    // Arrange
    toArray.mockResolvedValue([FACULTY_LUNCH, { ...FACULTY_LUNCH, _id: "10201031:2026-10-14:L", meal: "X" }]);

    // Act
    const menus = await repository.listMenus(["10201030", "10201031"], "2026-10-14");

    // Assert
    expect(menus.map((m) => m._id)).toEqual(["10201030:2026-10-14:L"]);
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0]![0]).toEqual(expect.objectContaining({ event: "meals.menus.invalid_document" }));
    expect(logText(mockLogger.error.mock.calls[0])).toContain("10201031:2026-10-14:L: meal");
  });

  it("serves a date from one read within the TTL, reads again after it, and reads another date apart", async () => {
    // Arrange
    await repository.listMenus(["10201030"], "2026-10-14");

    // Act
    clock += MENU_CACHE_TTL_MS - 1;
    await repository.listMenus(["10201030"], "2026-10-14");
    await repository.listMenus(["10201030"], "2026-10-15");
    clock += 1;
    await repository.listMenus(["10201030"], "2026-10-14");

    // Assert
    expect(find).toHaveBeenCalledTimes(3);
    expect(find.mock.calls.map(([filter]) => (filter as { _id: { $in: string[] } })._id.$in[0])).toEqual([
      "10201030:2026-10-14:B",
      "10201030:2026-10-15:B",
      "10201030:2026-10-14:B",
    ]);
  });

  it("surfaces a failed read", async () => {
    // Arrange
    toArray.mockRejectedValue(new Error("mongo down"));

    // Act & Assert
    await expect(repository.listMenus(["10201030"], "2026-10-14")).rejects.toThrow("mongo down");
  });
});
