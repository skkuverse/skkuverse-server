/**
 * BuildingPlaceRepository: the synced spaces the place index is built from,
 * read whole behind a single-flight cache. What it guards: one read of the
 * spaces with a spaceCd, only the fields the index reads, in the order of the
 * spaces' unique index and within the hot-read bound, which
 * FakeBuildingPlaceRepository follows; a space skkuverse-crawler wrote that
 * does not parse is left out and logged by its spaceCd; the TTL forces a
 * re-read; and a failed read reaches the caller instead of an empty index.
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
      collection: (name: string) => (name === "spaces" ? { find } : {}),
    })),
  })),
}));

import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { BUILDING_CACHE_TTL_MS } from "../building.constants";
import { BuildingPlaceRepository } from "./building-place.repository";

const SPACE = { spaceCd: "33B101", buildNo: "133", campus: "hssc" };

let clock = 1_000_000;
let repository: BuildingPlaceRepository;

beforeEach(() => {
  jest.clearAllMocks();
  clock = 1_000_000;
  jest.spyOn(Date, "now").mockImplementation(() => clock);
  toArray.mockResolvedValue([SPACE]);
  repository = new BuildingPlaceRepository();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("BuildingPlaceRepository.listSpaces", () => {
  it("reads every space with a spaceCd once, with only the fields the index reads, in spaceCd order", async () => {
    // Act
    const [first, second] = await Promise.all([repository.listSpaces(), repository.listSpaces()]);

    // Assert
    expect(first).toEqual([SPACE]);
    expect(second).toBe(first);
    expect(find).toHaveBeenCalledTimes(1);
    expect(find.mock.calls[0]).toEqual([
      { spaceCd: { $ne: null } },
      {
        projection: { _id: 0, spaceCd: 1, buildNo: 1, campus: 1, buildingName: 1 },
        maxTimeMS: HOT_READ_MAX_TIME_MS,
      },
    ]);
    expect(sort.mock.calls[0]).toEqual([{ spaceCd: 1, buildNo: 1, campus: 1 }]);
  });

  it("leaves out and logs a space that does not parse, and keeps the rest", async () => {
    // Arrange
    toArray.mockResolvedValue([SPACE, { ...SPACE, spaceCd: "33B102", campus: "seoul" }, { ...SPACE, spaceCd: "33B103", buildNo: undefined }]);

    // Act
    const spaces = await repository.listSpaces();

    // Assert
    expect(spaces).toEqual([SPACE]);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { event: "building.spaces.invalid", count: 2, invalid: ["33B102: campus", "33B103: buildNo"] },
      expect.any(String),
    );
  });

  it("serves the cached read within the TTL and re-reads once it has passed", async () => {
    // Arrange
    await repository.listSpaces();

    // Act
    clock += BUILDING_CACHE_TTL_MS - 1;
    await repository.listSpaces();
    clock += 1;
    await repository.listSpaces();

    // Assert
    expect(find).toHaveBeenCalledTimes(2);
  });

  it("surfaces a failed read", async () => {
    // Arrange
    toArray.mockRejectedValue(new Error("mongo down"));

    // Act & Assert
    await expect(repository.listSpaces()).rejects.toThrow("mongo down");
  });
});
