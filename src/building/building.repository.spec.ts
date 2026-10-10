/**
 * The building list and the campus shapes are read on every map open and every
 * /building/* request, so both sit behind a single-flight cache. What matters:
 * concurrent requests cost one scan, a sync's clearCache() forces the next read
 * back to the database, a buildings failure still reaches the caller (that is
 * what marks the campus overlay degraded), and a shapes failure serves the last
 * good shapes rather than an outline-less map cached for a day.
 */
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../infra/logger", () => mockLogger);

const toArrayFor: Record<string, jest.Mock> = {
  buildings: jest.fn(),
  campus_shapes: jest.fn(),
};
const findFor: Record<string, jest.Mock> = {};
for (const name of Object.keys(toArrayFor)) {
  findFor[name] = jest.fn(() => ({
    sort: jest.fn(() => ({ toArray: toArrayFor[name] })),
  }));
}

// Records which COLLECTION each index was created on (see "ensureIndexes").
const createIndex = jest.fn().mockResolvedValue(undefined);

jest.mock("../infra/db", () => ({
  HOT_READ_MAX_TIME_MS: jest.requireActual("../infra/db").HOT_READ_MAX_TIME_MS,
  getClient: jest.fn(() => ({
    db: jest.fn(() => ({
      collection: (name: string) => ({
        find: findFor[name],
        createIndex: (keys: unknown, options?: unknown) =>
          createIndex(name, keys, ...(options === undefined ? [] : [options])),
      }),
    })),
  })),
}));

import { BuildingRepository } from "./building.repository";
import { HOT_READ_MAX_TIME_MS } from "../infra/db";

const HSSC = { _id: 1, campus: "hssc" };
const NSC = { _id: 2, campus: "nsc" };
const RING = [
  [126.9944, 37.5873],
  [126.9954, 37.5873],
  [126.9954, 37.5883],
  [126.9944, 37.5883],
  [126.9944, 37.5873],
];
const SHAPE = {
  _id: "wall",
  campus: "hssc",
  layerId: "building_labels",
  geometry: { type: "Polygon", coordinates: [RING] },
  title: { ko: "담장", en: "Wall" },
  subtitle: null,
  skkuId: null,
  order: 1,
};
const FIVE_MIN = 5 * 60 * 1000;

const repository = new BuildingRepository();
const { clearCache, listBuildings, listCampusShapes } = {
  clearCache: () => repository.clearCache(),
  listBuildings: (...args: Parameters<BuildingRepository["listBuildings"]>) =>
    repository.listBuildings(...args),
  listCampusShapes: () => repository.listCampusShapes(),
};
const ensureIndexes = () => repository.ensureIndexes();

let clock = 1_000_000;
beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
  clock = 1_000_000;
  jest.spyOn(Date, "now").mockImplementation(() => clock);
  toArrayFor.buildings!.mockResolvedValue([HSSC, NSC]);
  toArrayFor.campus_shapes!.mockResolvedValue([SHAPE]);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("listBuildings", () => {
  it("scans once for concurrent requests, and filters the cached list by campus", async () => {
    const [all, hssc, nsc] = await Promise.all([
      listBuildings(),
      listBuildings("hssc"),
      listBuildings("nsc"),
    ]);
    expect(all).toEqual([HSSC, NSC]);
    expect(hssc).toEqual([HSSC]);
    expect(nsc).toEqual([NSC]);
    expect(findFor.buildings).toHaveBeenCalledTimes(1);
    expect(findFor.buildings!.mock.calls[0]![1]).toMatchObject({
      maxTimeMS: HOT_READ_MAX_TIME_MS,
    });
  });

  it("re-reads after clearCache(), which the building sync calls after writing", async () => {
    await listBuildings();
    clearCache();
    await listBuildings();
    expect(findFor.buildings).toHaveBeenCalledTimes(2);
  });

  it("re-reads once the TTL has passed", async () => {
    await listBuildings();
    clock += FIVE_MIN;
    await listBuildings();
    expect(findFor.buildings).toHaveBeenCalledTimes(2);
  });

  it("still surfaces a failed read, which is what marks the overlay degraded", async () => {
    await listBuildings();
    toArrayFor.buildings!.mockRejectedValue(new Error("mongo down"));
    clock += FIVE_MIN;
    await expect(listBuildings()).rejects.toThrow("mongo down");
  });
});

describe("listCampusShapes", () => {
  it("is cached like the buildings", async () => {
    await Promise.all([listCampusShapes(), listCampusShapes()]);
    await listCampusShapes();
    expect(findFor.campus_shapes).toHaveBeenCalledTimes(1);
    expect(findFor.campus_shapes!.mock.calls[0]).toEqual([
      {},
      {
        projection: {
          _id: 1,
          campus: 1,
          layerId: 1,
          geometry: 1,
          title: 1,
          subtitle: 1,
          skkuId: 1,
          order: 1,
        },
        maxTimeMS: HOT_READ_MAX_TIME_MS,
      },
    ]);
  });

  it("leaves out a shape that does not parse, logs it, and keeps the rest", async () => {
    toArrayFor.campus_shapes!.mockResolvedValue([
      SHAPE,
      { ...SHAPE, _id: "broken-ring", geometry: { type: "Polygon", coordinates: [null] } },
      { ...SHAPE, _id: "string-id", skkuId: "12" },
      { ...SHAPE, _id: "extra", updatedAt: new Date(0), note: "ignored" },
    ]);
    await expect(listCampusShapes()).resolves.toEqual([SHAPE, { ...SHAPE, _id: "extra" }]);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "building.campus_shapes.invalid",
        count: 2,
        invalid: ["broken-ring: geometry", "string-id: skkuId"],
      }),
      expect.any(String),
    );
  });

  it("serves the last good shapes when a re-read fails, with a warning", async () => {
    await listCampusShapes();
    toArrayFor.campus_shapes!.mockRejectedValue(new Error("mongo down"));
    clock += FIVE_MIN;
    await expect(listCampusShapes()).resolves.toEqual([SHAPE]);
    // Answered from the old shapes at once; the failed reload logs behind it.
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
  });

  it("re-reads after clearCache()", async () => {
    await listCampusShapes();
    clearCache();
    await listCampusShapes();
    expect(findFor.campus_shapes).toHaveBeenCalledTimes(2);
  });
});

/**
 * The building DB's indexes, and specifically the two on `campus_shapes`.
 *
 * The 2dsphere is the reason this file exists. It is NOT a query index — no geo
 * query is ever run against campus geometry — it is there because Mongo refuses
 * an unclosed ring, a self-intersecting loop and a hole outside its exterior AT
 * INSERT. That is the cheapest guard available against geometry that would fail
 * to draw, and it is completely silent when missing: the import succeeds, the
 * shape stores, and the campus map draws nothing where the outline should be.
 *
 * The mock records which COLLECTION each index was created on, because one
 * shared spy cannot tell `campus_shapes.createIndex({campus: 1})` from the same
 * call against `buildings` — and an index on the wrong collection is exactly
 * the mistake that is silent in production.
 */
describe("BuildingRepository.ensureIndexes", () => {
  it("creates a 2dsphere on campus_shapes.geometry — the insert-time ring guard", async () => {
    await ensureIndexes();

    expect(createIndex).toHaveBeenCalledWith("campus_shapes", {
      geometry: "2dsphere",
    });
  });

  it("covers the one read there is, rather than a filter nothing uses", async () => {
    await ensureIndexes();

    // `listCampusShapes` is `find({}).sort({order: 1, _id: 1})` — no campus
    // predicate anywhere — so this is the sort, not a filter.
    expect(createIndex).toHaveBeenCalledWith("campus_shapes", { order: 1, _id: 1 });
    expect(createIndex).not.toHaveBeenCalledWith("campus_shapes", { campus: 1 });
  });

  it("leaves the existing collections' indexes alone", async () => {
    await ensureIndexes();

    // Regression guard for the one-line mistake this file is shaped to catch:
    // adding a collection to ensureIndexes and hanging its indexes off the
    // wrong handle.
    expect(createIndex).toHaveBeenCalledWith("buildings", { location: "2dsphere" });
    expect(createIndex).toHaveBeenCalledWith("buildings", { campus: 1 });
    expect(createIndex).toHaveBeenCalledWith("spaces", { campus: 1 });
  });
});

describe("BuildingRepository.onModuleInit", () => {
  it("ensures the indexes and logs it", async () => {
    await expect(repository.onModuleInit()).resolves.toBeUndefined();
    expect(createIndex).toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith({ event: "building.indexes.ensured" }, expect.any(String));
  });

  it("swallows an index failure (warn-and-continue, no throw)", async () => {
    createIndex.mockRejectedValueOnce(new Error("no db"));
    await expect(repository.onModuleInit()).resolves.toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "building.indexes.failed" }),
      expect.any(String),
    );
  });
});
