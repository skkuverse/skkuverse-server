/**
 * BusRegistryRepository over a mocked Mongo seam (src/infra/db): seeding is
 * an upsert of `$setOnInsert` on the route id, so it inserts once and never
 * overwrites; the read is bounded, projects the stored fields and parses the
 * document; and replacing the stations is guarded by the stations version the
 * caller read, so a stale writer changes nothing.
 */

const mockUpdateOne = jest.fn();
const mockFindOne = jest.fn();

jest.mock("../../infra/db", () => ({
  HOT_READ_MAX_TIME_MS: 3000,
  getClient: jest.fn().mockReturnValue({
    db: jest.fn().mockReturnValue({
      collection: jest.fn().mockReturnValue({ updateOne: mockUpdateOne, findOne: mockFindOne }),
    }),
  }),
}));

jest.mock("../../infra/config", () => ({
  mongo: { dbName: "bus_campus_test", collections: { jongroRoutes: "jongro_routes" } },
}));

import type { JongroRouteDocument } from "./bus-registry.document";
import { BusRegistryRepository } from "./bus-registry.repository";

const SYNCED_AT = new Date("2026-10-17T12:00:00Z");
const doc = (overrides: Partial<JongroRouteDocument> = {}): JongroRouteDocument => ({
  _id: "jongro07",
  stations: [{ topisId: "A", arsId: "01", stationName: "a", sequence: 1 }],
  turnaroundTopisId: "A",
  stationsVersion: "v1",
  syncedAt: SYNCED_AT,
  ...overrides,
});

let repository: BusRegistryRepository;

beforeEach(() => {
  jest.clearAllMocks();
  repository = new BusRegistryRepository();
});

describe("BusRegistryRepository.insertRoute", () => {
  it("upserts the route with $setOnInsert on its id and reports the insert", async () => {
    // Arrange
    mockUpdateOne.mockResolvedValue({ upsertedCount: 1, matchedCount: 0 });

    // Act
    const inserted = await repository.insertRoute(doc());

    // Assert
    expect(inserted).toBe(true);
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: "jongro07" },
      { $setOnInsert: { stations: doc().stations, turnaroundTopisId: "A", stationsVersion: "v1", syncedAt: SYNCED_AT } },
      { upsert: true },
    );
  });

  it("reports no insert when the document already exists", async () => {
    // Arrange
    mockUpdateOne.mockResolvedValue({ upsertedCount: 0, matchedCount: 1 });

    // Act & Assert
    expect(await repository.insertRoute(doc())).toBe(false);
  });
});

describe("BusRegistryRepository.findRoute", () => {
  it("reads one route by id, bounded, with a literal projection, and parses it", async () => {
    // Arrange
    mockFindOne.mockResolvedValue({ ...doc(), extra: "dropped" });

    // Act
    const found = await repository.findRoute("jongro07");

    // Assert
    expect(found).toEqual(doc());
    expect(mockFindOne).toHaveBeenCalledWith(
      { _id: "jongro07" },
      { projection: { stations: 1, turnaroundTopisId: 1, stationsVersion: 1, syncedAt: 1 }, maxTimeMS: 3000 },
    );
  });

  it("answers null for a missing route", async () => {
    // Arrange
    mockFindOne.mockResolvedValue(null);

    // Act & Assert
    expect(await repository.findRoute("jongro02")).toBeNull();
  });

  it("rejects a document that lost a field", async () => {
    // Arrange
    mockFindOne.mockResolvedValue({ ...doc(), stationsVersion: undefined });

    // Act & Assert
    await expect(repository.findRoute("jongro07")).rejects.toThrow(/stationsVersion/);
  });
});

describe("BusRegistryRepository.updateStations", () => {
  it("sets the new stations only where the stored version is the one read", async () => {
    // Arrange
    mockUpdateOne.mockResolvedValue({ matchedCount: 1 });
    const next = { stations: doc().stations, turnaroundTopisId: "A", stationsVersion: "v2", syncedAt: SYNCED_AT };

    // Act
    const written = await repository.updateStations("jongro07", "v1", next);

    // Assert
    expect(written).toBe(true);
    expect(mockUpdateOne).toHaveBeenCalledWith({ _id: "jongro07", stationsVersion: "v1" }, { $set: next });
  });

  it("writes nothing when another writer changed the version first", async () => {
    // Arrange
    mockUpdateOne.mockResolvedValue({ matchedCount: 0 });
    const next = { stations: doc().stations, turnaroundTopisId: "A", stationsVersion: "v2", syncedAt: SYNCED_AT };

    // Act & Assert
    expect(await repository.updateStations("jongro07", "stale", next)).toBe(false);
  });
});
