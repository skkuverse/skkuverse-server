/**
 * syncBuildings' failure contract. The poller registry only learns about a
 * failed run if syncBuildings rejects, so:
 *  - phase 1 failing (a fetch error, or a buildList too short to trust) stops
 *    the run and rejects;
 *  - phase 2 or phase 3 failing lets the later phases and clearCache() run,
 *    then rejects once with an AggregateError naming every failed phase;
 *  - syncBuildings logs no error line itself — the registry does.
 * axios, the building collections and the logger are mocked, so neither SKKU
 * nor MongoDB is reached.
 */

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../infra/logger", () => mockLogger);

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
jest.mock("./building.data", () => ({
  clearCache: () => mockDb.clearCache(),
  getRawBuildingsCollection: () => mockDb.raw,
  getBuildingsCollection: () => mockDb.enriched,
  getSpacesCollection: () => mockDb.spaces,
}));

import { syncBuildings } from "./building.sync";

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
    () => new Error("expected syncBuildings to reject"),
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

describe("syncBuildings", () => {
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
