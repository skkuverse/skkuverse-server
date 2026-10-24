/**
 * BuildingCafeteriaListRepository: the cafeterias other features list (the
 * meals screen), read on every request, so they sit behind a single-flight
 * cache. What it guards: one read serves both campuses, filtered by campus;
 * the read's filter, projection, sort and time bound, which
 * FakeBuildingCafeteriaListRepository follows; a cafeteria skkuverse-crawler
 * wrote that does not parse is left out and logged; the TTL forces a re-read;
 * and a failed read reaches the caller instead of an empty list.
 */
const toArray = jest.fn();
const sort = jest.fn(() => ({ toArray }));
const find = jest.fn(() => ({ sort }));

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../infra/logger", () => mockLogger);

jest.mock("../../infra/db", () => ({
  HOT_READ_MAX_TIME_MS: jest.requireActual("../../infra/db").HOT_READ_MAX_TIME_MS,
  getClient: jest.fn(() => ({
    db: jest.fn(() => ({
      collection: (name: string) => (name === "facilities" ? { find } : {}),
    })),
  })),
}));

import { storedFacilities } from "../../../__tests__/helpers/building/facilities";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { BUILDING_CACHE_TTL_MS } from "../building.constants";
import { BuildingCafeteriaListRepository } from "./building-cafeteria-list.repository";

const [HSSC_DOC, NSC_DOC] = storedFacilities().cafeterias;
const HSSC_CAFETERIA = {
  _id: "10201030",
  campus: "hssc",
  name: { ko: "패컬티식당", en: "Faculty Dining Hall" },
  buildNo: "101",
  floor: { ko: "6층", en: "6F" },
  spaceCd: "10607A",
  location: { type: "Point", coordinates: [126.994501, 37.587584] },
};
const NSC_CAFETERIA = {
  _id: "20201040",
  campus: "nsc",
  name: { ko: "구시재식당", en: "Faculty Cafeteria(Gusijae)" },
  buildNo: "204",
  floor: { ko: "3층", en: "3F" },
  spaceCd: null,
  location: { type: "Point", coordinates: [126.972533, 37.29396] },
};

let clock = 1_000_000;
let repository: BuildingCafeteriaListRepository;

beforeEach(() => {
  jest.clearAllMocks();
  clock = 1_000_000;
  jest.spyOn(Date, "now").mockImplementation(() => clock);
  toArray.mockResolvedValue([HSSC_DOC, NSC_DOC]);
  repository = new BuildingCafeteriaListRepository();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("BuildingCafeteriaListRepository.listCafeterias", () => {
  it("reads every cafeteria once, with only the fields a listing serves, in conspaceCd order", async () => {
    // Act
    const [hssc, nsc] = await Promise.all([repository.listCafeterias("hssc"), repository.listCafeterias("nsc")]);

    // Assert
    expect(hssc).toEqual([HSSC_CAFETERIA]);
    expect(nsc).toEqual([NSC_CAFETERIA]);
    expect(find).toHaveBeenCalledTimes(1);
    expect(find.mock.calls[0]).toEqual([
      { kind: "cafeteria" },
      {
        projection: { _id: 1, campus: 1, name: 1, buildNo: 1, floor: 1, spaceCd: 1, location: 1 },
        maxTimeMS: HOT_READ_MAX_TIME_MS,
      },
    ]);
    expect(sort.mock.calls[0]).toEqual([{ _id: 1 }]);
  });

  it("leaves out and logs a cafeteria that does not parse, keyed by its conspaceCd, and keeps the rest", async () => {
    // Arrange
    toArray.mockResolvedValue([HSSC_DOC, { ...NSC_DOC, buildNo: "" }, { ...NSC_DOC, _id: "20201041", name: null }]);

    // Act
    const [hssc, nsc] = await Promise.all([repository.listCafeterias("hssc"), repository.listCafeterias("nsc")]);

    // Assert
    expect(hssc).toEqual([HSSC_CAFETERIA]);
    expect(nsc).toEqual([]);
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn.mock.calls[0]?.[0]).toEqual({
      event: "building.cafeterias.invalid",
      count: 2,
      invalid: ["20201040: buildNo", "20201041: name"],
    });
  });

  it("serves the cached read within the TTL and re-reads once it has passed", async () => {
    // Arrange
    await repository.listCafeterias("hssc");

    // Act
    clock += BUILDING_CACHE_TTL_MS - 1;
    await repository.listCafeterias("hssc");
    clock += 1;
    await repository.listCafeterias("hssc");

    // Assert
    expect(find).toHaveBeenCalledTimes(2);
  });

  it("surfaces a failed read", async () => {
    // Arrange
    toArray.mockRejectedValue(new Error("mongo down"));

    // Act & Assert
    await expect(repository.listCafeterias("hssc")).rejects.toThrow("mongo down");
  });
});
