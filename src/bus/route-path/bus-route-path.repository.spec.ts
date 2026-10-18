/**
 * BusRoutePathRepository over a mocked Mongo seam (src/infra/db), on
 * `jongro_route_paths` in the bus database (add-jongro-route-lines D2):
 * seeding is an upsert of `$setOnInsert` on the route id, so it inserts once
 * and never overwrites; the read of every route is bounded and projects the
 * stored fields; and replacing a line is guarded by the version the caller
 * read, so a stale writer changes nothing.
 */

const mockUpdateOne = jest.fn();
const mockToArray = jest.fn();
const mockFind = jest.fn(() => ({ toArray: mockToArray }));
const mockCollection = jest.fn().mockReturnValue({ updateOne: mockUpdateOne, find: mockFind });
const mockDb = jest.fn().mockReturnValue({ collection: mockCollection });

jest.mock("../../infra/db", () => ({
  HOT_READ_MAX_TIME_MS: 3000,
  getClient: jest.fn().mockReturnValue({ db: mockDb }),
}));

jest.mock("../../infra/config", () => ({
  mongo: { dbName: "bus_campus_test", collections: { jongroRoutePaths: "jongro_route_paths" } },
}));

import type { JongroRoutePathDocument } from "./bus-route-path.document";
import { BusRoutePathRepository } from "./bus-route-path.repository";

const SYNCED_AT = new Date("2026-10-18T03:00:00Z");
const doc = (overrides: Partial<JongroRoutePathDocument> = {}): JongroRoutePathDocument => ({
  _id: "jongro07",
  busRouteId: "100900004",
  path: [[126.99, 37.58]],
  stations: [{ topisId: "A", arsId: "01", stationName: "a", sequence: 1, lng: 126.99, lat: 37.58, isTurnaround: false }],
  pathVersion: "v1",
  syncedAt: SYNCED_AT,
  ...overrides,
});
const stored = ({ _id: _routeId, ...rest }: JongroRoutePathDocument) => rest;

let repository: BusRoutePathRepository;

beforeEach(() => {
  jest.clearAllMocks();
  repository = new BusRoutePathRepository();
});

describe("BusRoutePathRepository.insertRoutePath", () => {
  it("upserts the line with $setOnInsert on its route id in jongro_route_paths and reports the insert", async () => {
    // Arrange
    mockUpdateOne.mockResolvedValue({ upsertedCount: 1, matchedCount: 0 });

    // Act
    const inserted = await repository.insertRoutePath(doc());

    // Assert
    expect(inserted).toBe(true);
    expect(mockDb).toHaveBeenCalledWith("bus_campus_test");
    expect(mockCollection).toHaveBeenCalledWith("jongro_route_paths");
    expect(mockUpdateOne).toHaveBeenCalledWith({ _id: "jongro07" }, { $setOnInsert: stored(doc()) }, { upsert: true });
  });

  it("reports no insert when the route is already stored", async () => {
    // Arrange
    mockUpdateOne.mockResolvedValue({ upsertedCount: 0, matchedCount: 1 });

    // Act & Assert
    expect(await repository.insertRoutePath(doc())).toBe(false);
  });
});

describe("BusRoutePathRepository.listRoutePaths", () => {
  it("reads every stored route, bounded, with a literal projection of the stored fields", async () => {
    // Arrange
    mockToArray.mockResolvedValue([doc()]);

    // Act
    const routePaths = await repository.listRoutePaths();

    // Assert
    expect(routePaths).toEqual([doc()]);
    expect(mockFind).toHaveBeenCalledWith({}, { projection: { busRouteId: 1, path: 1, stations: 1, pathVersion: 1, syncedAt: 1 }, maxTimeMS: 3000 });
  });
});

describe("BusRoutePathRepository.updateRoutePath", () => {
  it("sets the new line only where the stored version is the one read", async () => {
    // Arrange
    mockUpdateOne.mockResolvedValue({ matchedCount: 1 });
    const next = doc({ pathVersion: "v2" });

    // Act
    const written = await repository.updateRoutePath("v1", next);

    // Assert
    expect(written).toBe(true);
    expect(mockUpdateOne).toHaveBeenCalledWith({ _id: "jongro07", pathVersion: "v1" }, { $set: stored(next) });
  });

  it("writes nothing when another writer changed the version first", async () => {
    // Arrange
    mockUpdateOne.mockResolvedValue({ matchedCount: 0 });

    // Act & Assert
    expect(await repository.updateRoutePath("stale", doc())).toBe(false);
  });
});
