/**
 * BuildingSyncService.run()'s failure contract. The poller registry only learns
 * about a failed run if run() rejects, so:
 *  - phase 1 failing (a fetch error, or a buildList too short to trust) stops
 *    the run and rejects;
 *  - phase 2 or phase 3 failing lets the later phases and clearCache() run,
 *    then rejects once with an AggregateError naming every failed phase;
 *  - run() logs no error line itself — the registry does.
 * axios, the building collections and the logger are mocked, so neither SKKU
 * nor MongoDB is reached; the client and the sync repository are real.
 */

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../infra/logger", () => mockLogger);

const mockGet = jest.fn();
jest.mock("axios", () => ({ get: mockGet }));

function fakeCollection() {
  return {
    find: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) })),
    bulkWrite: jest
      .fn()
      .mockResolvedValue({ matchedCount: 0, upsertedCount: 0, modifiedCount: 0 }),
    updateOne: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
  };
}

const mockDb = {
  raw: fakeCollection(),
  enriched: fakeCollection(),
  spaces: fakeCollection(),
  clearCache: jest.fn(),
};
jest.mock("../../infra/db", () => ({
  getClient: () => ({
    db: () => ({
      collection: (name: string) =>
        ({ buildings_raw: mockDb.raw, buildings: mockDb.enriched, spaces: mockDb.spaces })[name],
    }),
  }),
}));

import { BuildingSyncRepository } from "./building-sync.repository";
import { BuildingSyncService } from "./building-sync.service";
import { BuildingSyncClient } from "./building-sync.client";
import type { BuildingRepository } from "../building.repository";

const service = new BuildingSyncService(new BuildingSyncClient(), new BuildingSyncRepository(), {
  clearCache: () => mockDb.clearCache(),
} as unknown as BuildingRepository);
const syncBuildings = (): Promise<void> => service.run();

type Mode = "buildList" | "buildInfo" | "spaceList";

/** 60 buildings in all: above the 50 the sync needs to trust the list. */
const BUILDINGS_PER_CAMPUS = 30;
/** 5000 spaces in all: enough for the sync to delete stale spaces. */
const SPACES_PER_CAMPUS = 2500;

function buildItems(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i + 1),
    buildNo: String(i + 1),
    buildNm: `건물 ${i + 1}`,
  }));
}

function spaceItems(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    spaceCd: String(i + 1),
    buildNo: "1",
    spcaeNm: `공간 ${i + 1}`,
  }));
}

/** Answers each campusMap.do mode with healthy data unless a test overrides it. */
function skkuApi(overrides: Partial<Record<Mode, () => Promise<unknown>>> = {}): void {
  mockGet.mockImplementation((_url: string, { params }: { params: { mode: Mode } }) => {
    const override = overrides[params.mode];
    if (override) return override();
    switch (params.mode) {
      case "buildList":
        return Promise.resolve({ data: { buildItems: buildItems(BUILDINGS_PER_CAMPUS) } });
      case "buildInfo":
        return Promise.resolve({
          data: { attachItem: [], floorItem: [{ space_cd: "101", spcae_nm: "강의실" }] },
        });
      case "spaceList":
        return Promise.resolve({ data: { items: spaceItems(SPACES_PER_CAMPUS) } });
    }
  });
}

const calledModes = (): Mode[] =>
  mockGet.mock.calls.map(([, opts]) => (opts as { params: { mode: Mode } }).params.mode);

const loggedEvents = (mock: jest.Mock): string[] =>
  mock.mock.calls.map(([fields]) => (fields as { event: string }).event);

/** The rejection of a run that must fail. */
async function failureOf(run: Promise<void>): Promise<AggregateError> {
  const outcome = await run.then(
    () => new Error("expected run() to reject"),
    (err: unknown) => err,
  );
  expect(outcome).toBeInstanceOf(AggregateError);
  return outcome as AggregateError;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.raw = fakeCollection();
  mockDb.enriched = fakeCollection();
  mockDb.spaces = fakeCollection();
});

describe("BuildingSyncService.run", () => {
  it("resolves after a clean run, clears the cache and logs building.sync.completed", async () => {
    skkuApi();

    await syncBuildings();

    expect(mockDb.clearCache).toHaveBeenCalledTimes(1);
    expect(mockDb.spaces.deleteMany).toHaveBeenCalledTimes(1);
    const completed = mockLogger.info.mock.calls.find(
      ([fields]) => fields.event === "building.sync.completed",
    );
    expect(completed?.[0]).toMatchObject({ buildings: 60, spaces: 5000 });
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("rejects naming phase 1 when buildList fails, and writes nothing", async () => {
    const fetchError = new Error("timeout of 30000ms exceeded");
    skkuApi({ buildList: () => Promise.reject(fetchError) });

    const error = await failureOf(syncBuildings());

    expect(error.message).toMatch(/phase 1/);
    expect(error.errors).toEqual([fetchError]);
    expect(calledModes()).toEqual(["buildList"]);
    expect(mockDb.raw.bulkWrite).not.toHaveBeenCalled();
    expect(mockDb.clearCache).not.toHaveBeenCalled();
    expect(loggedEvents(mockLogger.info)).not.toContain("building.sync.completed");
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("rejects naming phase 1 when buildList returns fewer than 50 buildings, and writes nothing", async () => {
    skkuApi({
      buildList: () => Promise.resolve({ data: { buildItems: buildItems(10) } }),
    });

    const error = await failureOf(syncBuildings());

    expect(error.message).toMatch(/phase 1/);
    expect(error.errors).toHaveLength(1);
    expect((error.errors[0] as Error).message).toMatch(/20 buildings/);
    expect(mockDb.raw.bulkWrite).not.toHaveBeenCalled();
    expect(mockDb.clearCache).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("still runs phase 3 and clears the cache when phase 2 fails, then rejects naming phase 2", async () => {
    skkuApi();
    const writeError = new Error("bulk write failed");
    mockDb.spaces.bulkWrite.mockRejectedValueOnce(writeError);

    const error = await failureOf(syncBuildings());

    expect(error.message).toMatch(/phase 2/);
    expect(error.message).not.toMatch(/phase 3/);
    expect(error.errors).toEqual([writeError]);
    expect(calledModes()).toContain("spaceList");
    expect(mockDb.spaces.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockDb.clearCache).toHaveBeenCalledTimes(1);
    expect(loggedEvents(mockLogger.info)).not.toContain("building.sync.completed");
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("skips the stale delete but clears the cache when phase 3 fails, then rejects naming phase 3", async () => {
    const fetchError = new Error("socket hang up");
    skkuApi({ spaceList: () => Promise.reject(fetchError) });

    const error = await failureOf(syncBuildings());

    expect(error.message).toMatch(/phase 3/);
    expect(error.message).not.toMatch(/phase 2/);
    expect(error.errors).toEqual([fetchError]);
    expect(mockDb.spaces.deleteMany).not.toHaveBeenCalled();
    expect(mockDb.clearCache).toHaveBeenCalledTimes(1);
    expect(loggedEvents(mockLogger.info)).not.toContain("building.sync.completed");
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("rejects once, naming both phases in order, when phases 2 and 3 both fail", async () => {
    const fetchError = new Error("socket hang up");
    skkuApi({ spaceList: () => Promise.reject(fetchError) });
    const writeError = new Error("bulk write failed");
    mockDb.spaces.bulkWrite.mockRejectedValueOnce(writeError);

    const error = await failureOf(syncBuildings());

    expect(error.message).toMatch(/phase 2.*phase 3/);
    expect(error.errors).toEqual([writeError, fetchError]);
    expect(mockDb.clearCache).toHaveBeenCalledTimes(1);
  });
});

/**
 * Phase 2 one building at a time: a building whose buildInfo fails (the
 * fetch, or writing its photos) is noted on both layers and left out, and
 * every other building, in its batch and in later ones, still syncs. At most
 * five buildInfo requests are in flight at once, so the sync never floods
 * SKKU. Each building here has its own skkuId and buildNo (hssc 101-130, nsc
 * 201-230) and one room, `<buildNo>-101`.
 */
describe("BuildingSyncService.run, phase 2 per building", () => {
  type CampusMapParams = { mode: Mode; campusCd?: string; buildNo?: string };

  const roomsOf = (buildNo: string) =>
    Promise.resolve({ data: { attachItem: [], floorItem: [{ space_cd: `${buildNo}-101`, spcae_nm: "강의실" }] } });

  function campusMap(
    { buildInfo = roomsOf, facilitiesPerCampus = 0 }: {
      buildInfo?: (buildNo: string) => Promise<unknown>;
      facilitiesPerCampus?: number;
    } = {},
  ): void {
    mockGet.mockImplementation((_url: string, { params }: { params: CampusMapParams }) => {
      switch (params.mode) {
        case "buildList": {
          const base = params.campusCd === "1" ? 100 : 200;
          const buildings = Array.from({ length: BUILDINGS_PER_CAMPUS }, (_, i) => ({
            id: String(base + i + 1),
            buildNo: String(base + i + 1),
            buildNm: `건물 ${base + i + 1}`,
          }));
          const facilities = Array.from({ length: facilitiesPerCampus }, (_, i) => ({
            id: String(base + 90 + i),
            buildNo: "",
            buildNm: `시설 ${base + 90 + i}`,
          }));
          return Promise.resolve({ data: { buildItems: [...buildings, ...facilities] } });
        }
        case "buildInfo":
          return buildInfo(params.buildNo!);
        case "spaceList":
          return Promise.resolve({ data: { items: spaceItems(SPACES_PER_CAMPUS) } });
      }
    });
  }

  type UpdateCall = [{ _id: number }, { $set: Record<string, unknown> }];
  const updates = (collection: { updateOne: jest.Mock }): UpdateCall[] =>
    collection.updateOne.mock.calls as UpdateCall[];
  /** [skkuId, message] of each recordDetailError write on a layer. */
  const detailErrorsOn = (collection: { updateOne: jest.Mock }) =>
    updates(collection)
      .filter(([, update]) => !("attachments" in update.$set))
      .map(([filter, update]) => [filter._id, update.$set["sync.detailError"]]);
  /** The skkuIds whose photos were written on a layer. */
  const photosWrittenOn = (collection: { updateOne: jest.Mock }) =>
    updates(collection)
      .filter(([, update]) => "attachments" in update.$set)
      .map(([filter]) => filter._id);
  /** The spaceCds phase 2 upserted (its bulkWrite comes before phase 3's). */
  const buildInfoRooms = (): string[] => {
    const [ops] = mockDb.spaces.bulkWrite.mock.calls[0] as [Array<{ updateOne: { filter: { spaceCd: string } } }>];
    return ops.map((op) => op.updateOne.filter.spaceCd);
  };
  const infoFields = (event: string) =>
    mockLogger.info.mock.calls.find(([fields]) => fields.event === event)?.[0];

  it("notes a failed building on both layers, leaves its rooms out, and syncs every other batch", async () => {
    // Arrange
    // 103 is in the first batch of five, 230 in the last.
    const firstBatchError = new Error("Request failed with status code 500");
    const lastBatchError = new Error("timeout of 30000ms exceeded");
    campusMap({
      buildInfo: (buildNo) =>
        buildNo === "103"
          ? Promise.reject(firstBatchError)
          : buildNo === "230"
            ? Promise.reject(lastBatchError)
            : roomsOf(buildNo),
    });

    // Act
    const run = syncBuildings();

    // Assert
    await expect(run).resolves.toBeUndefined();
    expect(calledModes().filter((mode) => mode === "buildInfo")).toHaveLength(60);
    for (const layer of [mockDb.raw, mockDb.enriched]) {
      expect(detailErrorsOn(layer)).toEqual([
        [103, "Request failed with status code 500"],
        [230, "timeout of 30000ms exceeded"],
      ]);
      expect(photosWrittenOn(layer)).toHaveLength(58);
      expect(photosWrittenOn(layer)).not.toContain(103);
      expect(photosWrittenOn(layer)).not.toContain(230);
    }
    const rooms = buildInfoRooms();
    expect(rooms).toHaveLength(58);
    expect(rooms).not.toContain("103-101");
    expect(rooms).not.toContain("230-101");
    expect(rooms).toContain("229-101");
    const failures = mockLogger.warn.mock.calls
      .map(([fields]) => fields)
      .filter((fields) => fields.event === "building.sync.buildinfo_failed");
    expect(failures).toEqual([
      { event: "building.sync.buildinfo_failed", skkuId: 103, buildNo: "103", err: firstBatchError },
      { event: "building.sync.buildinfo_failed", skkuId: 230, buildNo: "230", err: lastBatchError },
    ]);
    expect(infoFields("building.sync.buildinfo_upserted")).toMatchObject({ processed: 58, errors: 2 });
    expect(infoFields("building.sync.completed")).toMatchObject({ buildings: 60 });
  });

  it("counts a building whose photos cannot be written as failed, with the write's message", async () => {
    // Arrange
    campusMap();
    const writeError = new Error("WriteConflict");
    mockDb.raw.updateOne.mockImplementation((filter: { _id: number }, update: { $set: object }) =>
      filter._id === 105 && "attachments" in update.$set ? Promise.reject(writeError) : Promise.resolve({}),
    );

    // Act
    const run = syncBuildings();

    // Assert
    await expect(run).resolves.toBeUndefined();
    expect(detailErrorsOn(mockDb.raw)).toEqual([[105, "WriteConflict"]]);
    expect(detailErrorsOn(mockDb.enriched)).toEqual([[105, "WriteConflict"]]);
    expect(buildInfoRooms()).not.toContain("105-101");
    expect(infoFields("building.sync.buildinfo_upserted")).toMatchObject({ processed: 59, errors: 1 });
  });

  it("notes a failure whose error has no message as unknown", async () => {
    // Arrange
    campusMap({ buildInfo: (buildNo) => (buildNo === "101" ? Promise.reject(new Error()) : roomsOf(buildNo)) });

    // Act
    await syncBuildings();

    // Assert
    expect(detailErrorsOn(mockDb.raw)).toEqual([[101, "unknown"]]);
  });

  it("logs a failure note it cannot write and still completes the run", async () => {
    // Arrange
    campusMap({
      buildInfo: (buildNo) => (buildNo === "101" ? Promise.reject(new Error("HTTP 502")) : roomsOf(buildNo)),
    });
    const noteError = new Error("not primary");
    mockDb.enriched.updateOne.mockImplementation((_filter: unknown, update: { $set: object }) =>
      "attachments" in update.$set ? Promise.resolve({}) : Promise.reject(noteError),
    );

    // Act
    const run = syncBuildings();

    // Assert
    await expect(run).resolves.toBeUndefined();
    expect(detailErrorsOn(mockDb.raw)).toEqual([[101, "HTTP 502"]]);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { event: "building.sync.error_note_failed", skkuId: 101, err: noteError },
      expect.any(String),
    );
    expect(infoFields("building.sync.completed")).toBeDefined();
  });

  it("requests no buildInfo for a facility without a buildNo", async () => {
    // Arrange
    campusMap({ facilitiesPerCampus: 2 });

    // Act
    await syncBuildings();

    // Assert
    expect(infoFields("building.sync.completed")).toMatchObject({ buildings: 64 });
    expect(calledModes().filter((mode) => mode === "buildInfo")).toHaveLength(60);
  });

  it("keeps at most five buildInfo requests in flight", async () => {
    // Arrange
    let inFlight = 0;
    let mostInFlight = 0;
    campusMap({
      buildInfo: async (buildNo) => {
        inFlight++;
        mostInFlight = Math.max(mostInFlight, inFlight);
        await new Promise((resolve) => setImmediate(resolve));
        inFlight--;
        return roomsOf(buildNo);
      },
    });

    // Act
    await syncBuildings();

    // Assert
    // Five is a courtesy limit toward SKKU's server; raising it is a decision,
    // not a refactor.
    expect(mostInFlight).toBe(5);
  });

  /**
   * More than half of the attempted buildings failing means SKKU is broken,
   * not one building, so phase 2 fails the run (shouldFailBuildInfoPhase). It
   * still records every failure, upserts the rooms it got and writes its
   * summary first, and phase 3 and the cache clear still run.
   */
  describe("when more than half of the buildInfo calls fail", () => {
    /** Rejects buildInfo for the given buildNos, each with its own error. */
    function failBuildInfo(failing: (buildNo: string) => boolean): Map<string, Error> {
      const errors = new Map<string, Error>();
      campusMap({
        buildInfo: (buildNo) => {
          if (!failing(buildNo)) return roomsOf(buildNo);
          const error = new Error(`buildInfo ${buildNo} failed`);
          errors.set(buildNo, error);
          return Promise.reject(error);
        },
      });
      return errors;
    }
    const summary = () => infoFields("building.sync.buildinfo_upserted");

    it("rejects naming phase 2 after recording every failure, and still runs phase 3", async () => {
      // Arrange
      const errors = failBuildInfo(() => true);

      // Act
      const error = await failureOf(syncBuildings());

      // Assert
      expect(error.message).toBe("Building sync failed in phase 2 (buildInfo)");
      expect(error.errors).toHaveLength(1);
      const phaseError = error.errors[0] as Error;
      expect(phaseError.message).toBe("buildInfo failed for 60 of 60 buildings");
      expect(phaseError.cause).toBe(errors.get("101"));
      expect(detailErrorsOn(mockDb.raw)).toHaveLength(60);
      expect(detailErrorsOn(mockDb.enriched)).toHaveLength(60);
      expect(
        mockLogger.warn.mock.calls.filter(([fields]) => fields.event === "building.sync.buildinfo_failed"),
      ).toHaveLength(60);
      expect(summary()).toEqual({
        event: "building.sync.buildinfo_upserted",
        matched: 0,
        upserted: 0,
        processed: 0,
        errors: 60,
      });
      expect(calledModes()).toContain("spaceList");
      expect(mockDb.spaces.deleteMany).toHaveBeenCalledTimes(1);
      expect(mockDb.clearCache).toHaveBeenCalledTimes(1);
      expect(infoFields("building.sync.completed")).toBeUndefined();
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it("upserts the rooms of the buildings that succeeded before rejecting at 31 of 60", async () => {
      // Arrange
      failBuildInfo((buildNo) => buildNo.startsWith("1") || buildNo === "201");

      // Act
      const error = await failureOf(syncBuildings());

      // Assert
      expect((error.errors[0] as Error).message).toBe("buildInfo failed for 31 of 60 buildings");
      const rooms = buildInfoRooms();
      expect(rooms).toHaveLength(29);
      expect(rooms).not.toContain("201-101");
      expect(rooms).toContain("202-101");
      expect(summary()).toMatchObject({ processed: 29, errors: 31 });
    });

    it("resolves when exactly half fail", async () => {
      // Arrange
      failBuildInfo((buildNo) => buildNo.startsWith("1"));

      // Act
      const run = syncBuildings();

      // Assert
      await expect(run).resolves.toBeUndefined();
      expect(summary()).toMatchObject({ processed: 30, errors: 30 });
      expect(infoFields("building.sync.completed")).toBeDefined();
    });

    it("names both phases, phase 2 first, when phase 3 fails too", async () => {
      // Arrange
      const spaceListError = new Error("socket hang up");
      failBuildInfo(() => true);
      const answer = mockGet.getMockImplementation()!;
      mockGet.mockImplementation((url: string, opts: { params: { mode: Mode } }) =>
        opts.params.mode === "spaceList" ? Promise.reject(spaceListError) : answer(url, opts),
      );

      // Act
      const error = await failureOf(syncBuildings());

      // Assert
      expect(error.message).toBe("Building sync failed in phase 2 (buildInfo) and phase 3 (spaceList)");
      expect((error.errors[0] as Error).message).toBe("buildInfo failed for 60 of 60 buildings");
      expect(error.errors[1]).toBe(spaceListError);
      expect(mockDb.spaces.deleteMany).not.toHaveBeenCalled();
      expect(mockDb.clearCache).toHaveBeenCalledTimes(1);
    });
  });

  describe("phase 2's summary log", () => {
    it("is written on a run that found no rooms, with nothing upserted", async () => {
      // Arrange
      campusMap({ buildInfo: () => Promise.resolve({ data: { attachItem: [], floorItem: [] } }) });

      // Act
      await syncBuildings();

      // Assert
      expect(infoFields("building.sync.buildinfo_upserted")).toEqual({
        event: "building.sync.buildinfo_upserted",
        matched: 0,
        upserted: 0,
        processed: 60,
        errors: 0,
      });
      expect(mockDb.spaces.bulkWrite).toHaveBeenCalledTimes(1);
    });

    it("is skipped when the rooms' upsert throws, and phase 2 fails", async () => {
      // Arrange
      campusMap();
      const writeError = new Error("bulk write failed");
      mockDb.spaces.bulkWrite.mockRejectedValueOnce(writeError);

      // Act
      const error = await failureOf(syncBuildings());

      // Assert
      expect(error.message).toBe("Building sync failed in phase 2 (buildInfo)");
      expect(error.errors).toEqual([writeError]);
      expect(infoFields("building.sync.buildinfo_upserted")).toBeUndefined();
    });
  });
});
