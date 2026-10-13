/**
 * MapRepository: the event map's boot-time indexes and the query shapes of its
 * activation read.
 *
 * Indexes. Two things are pinned, and only two:
 *
 *  1. The three indexes are actually created, ON THE RIGHT COLLECTIONS. The
 *     2dsphere is coordinate validation rather than a query index (ADR 0004
 *     invariant 3), and it is silent when missing — as is an index created
 *     against the wrong collection, which is why the mock records the name.
 *  2. A failure is non-fatal. Index creation is a startup nicety, not a serving
 *     prerequisite; an Atlas hiccup during boot must not take /map down.
 *
 * Queries. Each read's query object is pinned here, since FakeMapRepository
 * copies it. The activation filter carries two invariants nothing downstream can
 * recover from: a window containing now with null read as unbounded, and a
 * deterministic sort, so replicas cannot disagree about which layer set is
 * live. Every filter must match an index (docs/reference/event-places.md), or a
 * covered lookup quietly becomes a collection scan during the one week of the
 * year the collection is read constantly.
 *
 * src/infra/db.ts (whose client src/infra/mongo.ts opens collections on) and
 * src/infra/logger.ts are mocked.
 */
const findOne = jest.fn();
const toArray = jest.fn();
// The parameter is declared so mock.calls is typed as carrying one — the whole
// point of this file is asserting on the filters that get passed.
const find = jest.fn((_filter?: unknown) => ({ toArray }));
const createIndex = jest.fn().mockResolvedValue(undefined);

/**
 * Records the COLLECTION each index was created on, not just its keys.
 *
 * One shared mock cannot tell `activations.createIndex({enabled: 1})` from the
 * same call against `places`, so every index assertion would still pass with
 * the indexes on the wrong collections — which is exactly the mistake that is
 * silent in production.
 */
function collectionFor(name: string) {
  return {
    findOne,
    find,
    createIndex: (keys: unknown, options?: unknown) =>
      createIndex(name, keys, ...(options === undefined ? [] : [options])),
  };
}

jest.mock("../infra/db", () => ({
  HOT_READ_MAX_TIME_MS: jest.requireActual("../infra/db").HOT_READ_MAX_TIME_MS,
  getClient: jest.fn(() => ({
    db: jest.fn(() => ({ collection: (name: string) => collectionFor(name) })),
  })),
}));

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
jest.mock("../infra/logger", () => mockLogger);

import { HOT_READ_MAX_TIME_MS } from "../infra/db";
import { MapRepository } from "./map.repository";

const NOW = new Date("2026-09-16T09:00:00.000Z");

const repository = new MapRepository();
const findActiveActivation = (now: Date) => repository.findActiveActivation(now);
const listPlacesByLayerSetId = (layerSetId: string) => repository.listPlacesByLayerSetId(layerSetId);
const listPlacesWithDetailByLayerSetId = (layerSetId: string) => repository.listPlacesWithDetailByLayerSetId(layerSetId);
const ensureIndexes = () => repository.ensureIndexes();

/** Every (collection, keys, options?) call, as JSON for comparison. */
function indexSpecs(): string[] {
  return createIndex.mock.calls.map((c) => JSON.stringify(c));
}

beforeEach(() => {
  jest.clearAllMocks();
  createIndex.mockResolvedValue(undefined);
  toArray.mockResolvedValue([]);
  findOne.mockResolvedValue(null);
});

describe("MapRepository.onModuleInit", () => {
  it("creates every index the contract lists", async () => {
    // Act
    await new MapRepository().onModuleInit();

    // Assert
    expect(createIndex).toHaveBeenCalledTimes(3);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("indexes places for the marker scan and validates coordinates with 2dsphere", async () => {
    // Act
    await ensureIndexes();
    const specs = indexSpecs();

    // Assert
    // No lifecycle key: a cancelled booth is deleted, not flagged, so the one
    // scan this collection serves filters on layerSetId alone.
    expect(specs).toContain(JSON.stringify(["places", { layerSetId: 1 }]));
    // Not a query index. This is what makes Mongo reject a malformed pair at
    // insert, which is the only automatic guard against the [lng,lat] swap.
    expect(specs).toContain(JSON.stringify(["places", { location: "2dsphere" }]));
  });

  it("creates no session index, because there are no sessions", async () => {
    // Act
    await ensureIndexes();
    const specs = indexSpecs().join("|");

    // Assert
    // The four session access paths went with the collection. A booth's days are
    // `hours` on one document now, so there is nothing left to join or to scan
    // by dayIndex.
    expect(specs).not.toContain("deletedAt");
    expect(specs).not.toContain("placeId");
    expect(specs).not.toContain("dayIndex");
    expect(specs).not.toContain("startAt");
  });

  it("indexes activations to cover the liveness filter AND its sort", async () => {
    // Act
    await ensureIndexes();

    // Assert
    // Compound, because findActiveActivation sorts by activeFrom. A bare
    // {enabled: 1} leaves an in-memory sort stage on every /map/config.
    expect(indexSpecs()).toContain(
      JSON.stringify(["activations", { enabled: 1, activeFrom: -1 }]),
    );
  });

  it("creates no snapshot index, because there are no snapshots", async () => {
    // Act
    await ensureIndexes();
    const specs = indexSpecs().join("|");

    // Assert
    expect(specs).not.toContain("version");
    expect(specs).not.toContain("gcAt");
  });

  it("warns and continues when index creation fails", async () => {
    // Arrange
    createIndex.mockRejectedValue(new Error("Atlas is having a moment"));

    // Act & Assert
    // Resolves rather than rejecting: a rejected onModuleInit aborts Nest's
    // bootstrap, which is exactly the outage this catch exists to prevent.
    await expect(new MapRepository().onModuleInit()).resolves.toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalled();
  });
});

describe("MapRepository.findActiveActivation", () => {
  it("requires enabled AND a window containing now, treating null as unbounded", async () => {
    // Act
    await findActiveActivation(NOW);

    // Assert
    // {field: null} matches a MISSING field too, which is what makes a
    // hand-typed activation carrying only `enabled` work.
    expect(findOne.mock.calls[0]![0]).toEqual({
      enabled: true,
      $and: [
        { $or: [{ activeFrom: null }, { activeFrom: { $lte: NOW } }] },
        { $or: [{ activeUntil: null }, { activeUntil: { $gt: NOW } }] },
      ],
    });
  });

  it("sorts deterministically so replicas cannot disagree", async () => {
    // Act
    // Nothing stops ops enabling two overlapping layer sets. An unsorted findOne
    // would let the poller and each api replica pick a different one, flapping
    // the advertised activeLayerSetId between requests.
    await findActiveActivation(NOW);

    // Assert
    expect(findOne.mock.calls[0]![1]).toEqual({
      sort: { activeFrom: -1, _id: 1 },
      maxTimeMS: HOT_READ_MAX_TIME_MS,
    });
  });
});

describe("MapRepository.listPlacesByLayerSetId", () => {
  it("reads one layer set's places, with no lifecycle filter, under the hot-read bound", async () => {
    // Act
    await listPlacesByLayerSetId("eskara-2026");

    // Assert
    // No lifecycle filter: a cancelled booth is deleted, not flagged.
    expect(find.mock.calls).toEqual([[{ layerSetId: "eskara-2026" }, { maxTimeMS: HOT_READ_MAX_TIME_MS }]]);
  });
});

describe("MapRepository.listPlacesWithDetailByLayerSetId", () => {
  it("reads only the places of one layer set that carry a sheet", async () => {
    // Act
    await listPlacesWithDetailByLayerSetId("eskara-2026");

    // Assert
    // `$ne: null` also leaves out a place whose detail field is missing.
    expect(find.mock.calls).toEqual([[{ layerSetId: "eskara-2026", detail: { $ne: null } }, { maxTimeMS: HOT_READ_MAX_TIME_MS }]]);
  });
});
