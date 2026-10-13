/**
 * BuildingSyncService.run() over a scripted client, in-memory repositories
 * (the typed fakes in __tests__/helpers/fakes/building/) and a fixed Clock.
 * What it guards:
 *  - the failure contract the poller registry relies on: phase 1 failing (a
 *    fetch error, a list too short to trust, a raw building missing a field)
 *    stops the run; phase 2 or 3 failing lets the later phases and the cache
 *    clear run, then the run rejects once naming every failed phase; run()
 *    logs no error line itself
 *  - phase 1 re-enriches only the buildings SKKU changed or that an older
 *    enrichment wrote
 *  - phase 2 one building at a time: a failed building is noted on both layers
 *    and left out, the rest still sync, at most five requests are in flight,
 *    and more than half failing fails the phase after its summary
 *  - phase 3 deletes the spaces this run did not see, unless spaceList listed
 *    too few to trust
 *  - every write of a run is stamped with the Clock's time when the run
 *    started, which is also the stale-delete cutoff
 * The SKKU payload translation is building-sync.client.spec.ts's, and the exact
 * MongoDB writes are building-sync.repository.spec.ts's.
 */
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../infra/logger", () => mockLogger);

import { Test } from "@nestjs/testing";
import { FakeBuildingRepository } from "../../../__tests__/helpers/fakes/building/building.repository.fake";
import { FakeBuildingSyncClient } from "../../../__tests__/helpers/fakes/building/building-sync.client.fake";
import { FakeBuildingSyncRepository } from "../../../__tests__/helpers/fakes/building/building-sync.repository.fake";
import { Clock } from "../../infra/clock";
import type { BuildingDoc, BuildingRawDoc } from "../building.document";
import { BuildingRepository } from "../building.repository";
import type { BuildNo, Campus, SkkuId, SpaceCd } from "../building.types";
import type { ApiId } from "./building-sync.types";
import { BuildingSyncClient } from "./building-sync.client";
import { ENRICH_VERSION, enrichBuilding } from "./building-sync.mapper";
import { BuildingSyncRepository } from "./building-sync.repository";
import { BuildingSyncService } from "./building-sync.service";
import type { ListedBuilding, SyncedSpace } from "./building-sync.types";

/** 30 per campus, 60 in all: above the 50 the sync needs to trust the list. */
const BUILDINGS_PER_CAMPUS = 30;
/** 5000 spaces in all: enough for the sync to delete stale spaces. */
const SPACES_PER_CAMPUS = 2500;
const LAST_SYNC = new Date("2026-10-03T00:00:00Z");
// Far from LAST_SYNC and from the real time, so a run that reads `new Date()` instead of the Clock
// stamps its writes and cuts stale spaces at another instant.
const CLOCK_NOW = new Date("2031-03-04T05:06:07.000Z");

/** A building as the client lists it. hssc buildings are 101-130, nsc 201-230; skkuId, SKKU's id and buildNo agree. */
function listed(skkuId: number, campus: Campus, doc: Partial<ListedBuilding["doc"]> = {}): ListedBuilding {
  return {
    skkuId: skkuId as SkkuId,
    apiId: skkuId as ApiId,
    doc: {
      buildNo: String(skkuId) as BuildNo,
      campus,
      name: { ko: `건물 ${skkuId}`, en: `Building ${skkuId}` },
      description: { ko: "강의동", en: "Lecture hall" },
      location: { type: "Point", coordinates: [126.99, 37.58] },
      image: { url: null, filename: null },
      accessibility: { elevator: false, toilet: false },
      skkuCreatedAt: "2018-04-23",
      skkuUpdatedAt: "2026-09-01",
      ...doc,
    },
  };
}

function buildingsOf(campus: Campus, count = BUILDINGS_PER_CAMPUS): ListedBuilding[] {
  const base = campus === "hssc" ? 100 : 200;
  return Array.from({ length: count }, (_, i) => listed(base + i + 1, campus));
}

function spacesOf(campus: Campus, count = SPACES_PER_CAMPUS): SyncedSpace[] {
  const buildNo = (campus === "hssc" ? "101" : "201") as BuildNo;
  return Array.from({ length: count }, (_, i) => ({
    spaceCd: String(i + 1) as SpaceCd,
    buildNo,
    campus,
    floor: { ko: "1층", en: "1F" },
    name: { ko: `공간 ${i + 1}`, en: "" },
    buildingName: { ko: `건물 ${buildNo}`, en: "" },
    conspaceCd: `C${i + 1}`,
  }));
}

/** Each building's buildInfo: one photo and one room, `<buildNo>-101`. */
const roomsOf = async (building: ListedBuilding) => ({
  attachments: [{ id: building.skkuId, url: `https://www.skku.edu/${building.skkuId}.jpg`, filename: null, alt: "" }],
  spaces: [
    {
      spaceCd: `${building.doc.buildNo}-101` as SpaceCd,
      buildNo: building.doc.buildNo as BuildNo,
      campus: building.doc.campus,
      floor: { ko: "1층", en: "1F" },
      name: { ko: "강의실", en: "" },
      buildingName: building.doc.name,
      conspaceCd: null,
    },
  ],
});

let client: FakeBuildingSyncClient;
let repository: FakeBuildingSyncRepository;
let buildings: FakeBuildingRepository;
let service: BuildingSyncService;

/** SKKU answers every mode with healthy data; a test overrides what it needs. */
function healthySkku(): void {
  client.buildLists = { hssc: buildingsOf("hssc"), nsc: buildingsOf("nsc") };
  client.spaceLists = { hssc: spacesOf("hssc"), nsc: spacesOf("nsc") };
  client.buildInfo = roomsOf;
}

/** Spaces a previous run stored that SKKU no longer lists. */
function seedStaleSpaces(count: number, syncedAt = LAST_SYNC): void {
  for (let i = 0; i < count; i++) {
    const spaceCd = `gone-${i}` as SpaceCd;
    repository.spaces.set(`hssc/101/${spaceCd}`, {
      spaceCd,
      buildNo: "101" as BuildNo,
      campus: "hssc",
      floor: { ko: "1층", en: "1F" },
      name: { ko: "철거된 방", en: "" },
      conspaceCd: null,
      sources: ["spaceList"],
      syncedAt,
    });
  }
}
const staleSpacesLeft = (): number => [...repository.spaces.keys()].filter((key) => key.includes("/gone-")).length;

const infoFields = (event: string) => mockLogger.info.mock.calls.find(([fields]) => fields.event === event)?.[0];
const warnings = (event: string) =>
  mockLogger.warn.mock.calls.map(([fields]) => fields).filter((fields) => fields.event === event);

/** [skkuId, message] of each building noted as failed on a layer, in list order. */
const detailErrorsOn = (layer: Map<SkkuId, BuildingRawDoc | BuildingDoc>) =>
  [...layer.values()].filter((doc) => doc.sync?.detailError).map((doc) => [doc._id, doc.sync?.detailError]);
/** The skkuIds whose photos phase 2 wrote on a layer. */
const photosWrittenOn = (layer: Map<SkkuId, BuildingRawDoc | BuildingDoc>) =>
  [...layer.values()].filter((doc) => doc.sync?.detailAt).map((doc) => doc._id);

/** Each distinct instant among the stamps, as ISO text; a missing stamp shows as undefined. */
const distinctInstants = (stamps: Array<Date | null | undefined>) => [...new Set(stamps.map((at) => at?.toISOString()))];

/** The rejection of a run that must fail. */
async function failureOf(run: Promise<void>): Promise<AggregateError> {
  const outcome = await run.then(
    () => new Error("expected run() to reject"),
    (err: unknown) => err,
  );
  expect(outcome).toBeInstanceOf(AggregateError);
  return outcome as AggregateError;
}

beforeEach(async () => {
  jest.clearAllMocks();
  client = new FakeBuildingSyncClient();
  repository = new FakeBuildingSyncRepository();
  buildings = new FakeBuildingRepository();
  const fakeClock: Clock = { now: () => CLOCK_NOW };
  const moduleRef = await Test.createTestingModule({
    providers: [
      BuildingSyncService,
      { provide: BuildingSyncClient, useValue: client },
      { provide: BuildingSyncRepository, useValue: repository },
      { provide: BuildingRepository, useValue: buildings },
      { provide: Clock, useValue: fakeClock },
    ],
  }).compile();
  service = moduleRef.get(BuildingSyncService);
});

describe("BuildingSyncService.run", () => {
  it("resolves after a clean run, deletes the stale spaces, clears the cache and logs building.sync.completed", async () => {
    // Arrange
    healthySkku();
    seedStaleSpaces(3);

    // Act
    const run = service.run();

    // Assert
    await expect(run).resolves.toBeUndefined();
    expect(repository.raw.size).toBe(60);
    expect(repository.enriched.size).toBe(60);
    expect(staleSpacesLeft()).toBe(0);
    expect(infoFields("building.sync.stale_deleted")).toMatchObject({ deleted: 3 });
    expect(buildings.cacheClears).toBe(1);
    expect(infoFields("building.sync.completed")).toMatchObject({ buildings: 60, spaces: 5000 });
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("rejects naming phase 1 when buildList fails, and writes nothing", async () => {
    // Arrange
    healthySkku();
    const fetchError = new Error("timeout of 30000ms exceeded");
    client.buildLists.hssc = fetchError;

    // Act
    const error = await failureOf(service.run());

    // Assert
    expect(error.message).toBe("Building sync failed in phase 1 (buildList)");
    expect(error.errors).toEqual([fetchError]);
    expect(client.calls).toEqual([{ mode: "buildList", campus: "hssc" }]);
    expect(repository.raw.size).toBe(0);
    expect(buildings.cacheClears).toBe(0);
    expect(infoFields("building.sync.completed")).toBeUndefined();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("rejects naming phase 1 when buildList returns fewer than 50 buildings, and writes nothing", async () => {
    // Arrange
    healthySkku();
    client.buildLists = { hssc: buildingsOf("hssc", 10), nsc: buildingsOf("nsc", 10) };

    // Act
    const error = await failureOf(service.run());

    // Assert
    expect(error.message).toBe("Building sync failed in phase 1 (buildList)");
    expect(error.errors).toHaveLength(1);
    expect((error.errors[0] as Error).message).toBe("buildList returned 20 buildings, fewer than 50; nothing written");
    expect(repository.raw.size).toBe(0);
    expect(buildings.cacheClears).toBe(0);
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("still runs phase 3 and clears the cache when phase 2 fails, then rejects naming phase 2", async () => {
    // Arrange
    healthySkku();
    seedStaleSpaces(3);
    const writeError = new Error("bulk write failed");
    repository.upsertSpacesFailures = [writeError];

    // Act
    const error = await failureOf(service.run());

    // Assert
    expect(error.message).toBe("Building sync failed in phase 2 (buildInfo)");
    expect(error.errors).toEqual([writeError]);
    expect(client.callsOf("spaceList")).toHaveLength(2);
    expect(staleSpacesLeft()).toBe(0);
    expect(buildings.cacheClears).toBe(1);
    expect(infoFields("building.sync.completed")).toBeUndefined();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("skips the stale delete but clears the cache when phase 3 fails, then rejects naming phase 3", async () => {
    // Arrange
    healthySkku();
    seedStaleSpaces(3);
    const fetchError = new Error("socket hang up");
    client.spaceLists.hssc = fetchError;

    // Act
    const error = await failureOf(service.run());

    // Assert
    expect(error.message).toBe("Building sync failed in phase 3 (spaceList)");
    expect(error.errors).toEqual([fetchError]);
    expect(staleSpacesLeft()).toBe(3);
    expect(buildings.cacheClears).toBe(1);
    expect(infoFields("building.sync.completed")).toBeUndefined();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("rejects once, naming both phases in order, when phases 2 and 3 both fail", async () => {
    // Arrange
    healthySkku();
    const fetchError = new Error("socket hang up");
    client.spaceLists.hssc = fetchError;
    const writeError = new Error("bulk write failed");
    repository.upsertSpacesFailures = [writeError];

    // Act
    const error = await failureOf(service.run());

    // Assert
    expect(error.message).toBe("Building sync failed in phase 2 (buildInfo) and phase 3 (spaceList)");
    expect(error.errors).toEqual([writeError, fetchError]);
    expect(buildings.cacheClears).toBe(1);
  });

  it("keeps every stale space when spaceList lists fewer than 5000", async () => {
    // Arrange
    healthySkku();
    client.spaceLists = { hssc: spacesOf("hssc", 2499), nsc: spacesOf("nsc", 2499) };
    seedStaleSpaces(3);

    // Act
    const run = service.run();

    // Assert
    await expect(run).resolves.toBeUndefined();
    expect(staleSpacesLeft()).toBe(3);
    expect(warnings("building.sync.stale_delete_skipped")).toEqual([
      { event: "building.sync.stale_delete_skipped", count: 4998 },
    ]);
    expect(infoFields("building.sync.completed")).toMatchObject({ spaces: 4998 });
  });

  it("stamps every write of the run with the Clock's time", async () => {
    // Arrange
    healthySkku();

    // Act
    await service.run();

    // Assert
    const raw = [...repository.raw.values()];
    const enriched = [...repository.enriched.values()];
    const spaces = [...repository.spaces.values()];
    expect(distinctInstants(raw.flatMap((doc) => [doc.sync?.listAt, doc.sync?.detailAt]))).toEqual([
      CLOCK_NOW.toISOString(),
    ]);
    expect(
      distinctInstants(enriched.flatMap((doc) => [doc.updatedAt, doc.sync?.listAt, doc.sync?.detailAt])),
    ).toEqual([CLOCK_NOW.toISOString()]);
    expect(distinctInstants(spaces.map((space) => space.syncedAt))).toEqual([CLOCK_NOW.toISOString()]);
  });

  it("deletes a space this run did not list that was stamped 1 ms before the Clock's time", async () => {
    // Arrange
    healthySkku();
    seedStaleSpaces(3, new Date(CLOCK_NOW.getTime() - 1));

    // Act
    await service.run();

    // Assert
    expect(staleSpacesLeft()).toBe(0);
    expect(infoFields("building.sync.stale_deleted")).toMatchObject({ deleted: 3 });
  });
});

/**
 * Phase 1 enrichment. A building is re-enriched when it is new, when SKKU
 * changed it since the last run, or when an older ENRICH_VERSION wrote it;
 * the comparison must read the stamps before the raw upsert overwrites them. A
 * raw building missing a field every production document has makes
 * enrichment throw, so phase 1 fails after the raw upsert and before anything
 * is enriched, instead of writing blank fields.
 */
describe("BuildingSyncService.run, phase 1 enrichment", () => {
  /** The state a previous run left: every building raw and enriched at the current version. */
  async function seedPreviousRun(): Promise<void> {
    const previous = [...buildingsOf("hssc"), ...buildingsOf("nsc")];
    await repository.upsertRaw(previous, LAST_SYNC);
    await repository.upsertEnriched(
      previous.map(({ skkuId, doc }) => ({ skkuId, building: enrichBuilding({ ...doc, _id: skkuId }) })),
      LAST_SYNC,
    );
  }
  const listedHssc = (): ListedBuilding[] => client.buildLists.hssc as ListedBuilding[];

  it("enriches every building on a first run and completes", async () => {
    // Arrange
    healthySkku();

    // Act
    const run = service.run();

    // Assert
    await expect(run).resolves.toBeUndefined();
    expect(repository.enriched.size).toBe(60);
    expect(repository.enriched.get(101 as SkkuId)).toMatchObject({
      name: { ko: "건물 101", en: "Building 101" },
      displayNo: "1",
      enrichVersion: ENRICH_VERSION,
    });
    expect(infoFields("building.sync.enriched")).toMatchObject({ changed: 60 });
  });

  it("re-enriches only a building SKKU changed and one an older version enriched", async () => {
    // Arrange
    healthySkku();
    await seedPreviousRun();
    listedHssc()[0] = listed(101, "hssc", { skkuUpdatedAt: "2026-10-01", name: { ko: "새 이름", en: "New name" } });
    const olderVersion = repository.enriched.get(102 as SkkuId)!;
    repository.enriched.set(102 as SkkuId, { ...olderVersion, enrichVersion: ENRICH_VERSION - 1 });

    // Act
    await service.run();

    // Assert
    expect(infoFields("building.sync.enriched")).toMatchObject({ changed: 2 });
    expect(repository.enriched.get(101 as SkkuId)).toMatchObject({ name: { ko: "새 이름", en: "New name" } });
    expect(repository.enriched.get(102 as SkkuId)?.enrichVersion).toBe(ENRICH_VERSION);
    expect(repository.enriched.get(103 as SkkuId)?.updatedAt).toEqual(LAST_SYNC);
  });

  it("skips enrichment when no building changed", async () => {
    // Arrange
    healthySkku();
    await seedPreviousRun();

    // Act
    await service.run();

    // Assert
    expect(infoFields("building.sync.enrich_skipped")).toBeDefined();
    expect(infoFields("building.sync.enriched")).toBeUndefined();
    expect(repository.enriched.get(101 as SkkuId)?.updatedAt).toEqual(LAST_SYNC);
  });

  it.each(["name", "description", "accessibility"])(
    "rejects naming phase 1 when a changed raw building has no %s",
    async (field) => {
      // Arrange
      healthySkku();
      const broken = listed(101, "hssc");
      delete (broken.doc as unknown as Record<string, unknown>)[field];
      listedHssc()[0] = broken;

      // Act
      const error = await failureOf(service.run());

      // Assert
      expect(error.message).toBe("Building sync failed in phase 1 (buildList)");
      expect(error.errors[0]).toBeInstanceOf(TypeError);
      expect(repository.raw.size).toBe(60);
      expect(repository.enriched.size).toBe(0);
      expect(client.callsOf("buildInfo")).toEqual([]);
    },
  );
});

/**
 * Phase 2 one building at a time: a building whose buildInfo fails (the
 * fetch, or writing its photos) is noted on both layers and left out, and
 * every other building, in its batch and in later ones, still syncs. At most
 * five buildInfo requests are in flight at once, so the sync never floods
 * SKKU.
 */
describe("BuildingSyncService.run, phase 2 per building", () => {
  it("notes a failed building on both layers, leaves its rooms out, and syncs every other batch", async () => {
    // Arrange
    healthySkku();
    // 103 is in the first batch of five, 230 in the last.
    const firstBatchError = new Error("Request failed with status code 500");
    const lastBatchError = new Error("timeout of 30000ms exceeded");
    client.buildInfo = async (building) => {
      if (building.skkuId === 103) throw firstBatchError;
      if (building.skkuId === 230) throw lastBatchError;
      return roomsOf(building);
    };

    // Act
    const run = service.run();

    // Assert
    await expect(run).resolves.toBeUndefined();
    expect(client.callsOf("buildInfo")).toHaveLength(60);
    for (const layer of [repository.raw, repository.enriched]) {
      expect(detailErrorsOn(layer)).toEqual([
        [103, "Request failed with status code 500"],
        [230, "timeout of 30000ms exceeded"],
      ]);
      expect(photosWrittenOn(layer)).toHaveLength(58);
      expect(photosWrittenOn(layer)).not.toContain(103);
      expect(photosWrittenOn(layer)).not.toContain(230);
    }
    const rooms = repository.spaceCdsFrom("buildInfo");
    expect(rooms).toHaveLength(58);
    expect(rooms).not.toContain("103-101");
    expect(rooms).not.toContain("230-101");
    expect(rooms).toContain("229-101");
    expect(warnings("building.sync.buildinfo_failed")).toEqual([
      { event: "building.sync.buildinfo_failed", skkuId: 103, buildNo: "103", err: firstBatchError },
      { event: "building.sync.buildinfo_failed", skkuId: 230, buildNo: "230", err: lastBatchError },
    ]);
    expect(infoFields("building.sync.buildinfo_upserted")).toMatchObject({ processed: 58, errors: 2 });
    expect(infoFields("building.sync.completed")).toMatchObject({ buildings: 60 });
  });

  it("counts a building whose photos cannot be written as failed, with the write's message", async () => {
    // Arrange
    healthySkku();
    repository.setAttachmentsFailures.set(105 as SkkuId, new Error("WriteConflict"));

    // Act
    const run = service.run();

    // Assert
    await expect(run).resolves.toBeUndefined();
    expect(detailErrorsOn(repository.raw)).toEqual([[105, "WriteConflict"]]);
    expect(detailErrorsOn(repository.enriched)).toEqual([[105, "WriteConflict"]]);
    expect(repository.spaceCdsFrom("buildInfo")).not.toContain("105-101");
    expect(infoFields("building.sync.buildinfo_upserted")).toMatchObject({ processed: 59, errors: 1 });
  });

  it("notes a failure whose error has no message as unknown", async () => {
    // Arrange
    healthySkku();
    client.buildInfo = async (building) => {
      if (building.skkuId === 101) throw new Error();
      return roomsOf(building);
    };

    // Act
    await service.run();

    // Assert
    expect(detailErrorsOn(repository.raw)).toEqual([[101, "unknown"]]);
  });

  it("requests no buildInfo for a facility without a buildNo", async () => {
    // Arrange
    healthySkku();
    (client.buildLists.hssc as ListedBuilding[]).push(
      listed(191, "hssc", { buildNo: null }),
      listed(192, "hssc", { buildNo: null }),
    );
    (client.buildLists.nsc as ListedBuilding[]).push(
      listed(291, "nsc", { buildNo: null }),
      listed(292, "nsc", { buildNo: null }),
    );

    // Act
    await service.run();

    // Assert
    expect(infoFields("building.sync.completed")).toMatchObject({ buildings: 64 });
    expect(client.callsOf("buildInfo")).toHaveLength(60);
    expect(client.callsOf("buildInfo").map((call) => call.skkuId)).not.toContain(191);
  });

  it("keeps at most five buildInfo requests in flight", async () => {
    // Arrange
    healthySkku();
    let inFlight = 0;
    let mostInFlight = 0;
    client.buildInfo = async (building) => {
      inFlight++;
      mostInFlight = Math.max(mostInFlight, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight--;
      return roomsOf(building);
    };

    // Act
    await service.run();

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
    /** Rejects buildInfo for the matching buildings, each with its own error. */
    function failBuildInfo(failing: (skkuId: number) => boolean): Map<number, Error> {
      const errors = new Map<number, Error>();
      client.buildInfo = async (building) => {
        if (!failing(building.skkuId)) return roomsOf(building);
        const error = new Error(`buildInfo ${building.skkuId} failed`);
        errors.set(building.skkuId, error);
        throw error;
      };
      return errors;
    }
    const summary = () => infoFields("building.sync.buildinfo_upserted");

    it("rejects naming phase 2 after recording every failure, and still runs phase 3", async () => {
      // Arrange
      healthySkku();
      seedStaleSpaces(3);
      const errors = failBuildInfo(() => true);

      // Act
      const error = await failureOf(service.run());

      // Assert
      expect(error.message).toBe("Building sync failed in phase 2 (buildInfo)");
      expect(error.errors).toHaveLength(1);
      const phaseError = error.errors[0] as Error;
      expect(phaseError.message).toBe("buildInfo failed for 60 of 60 buildings");
      expect(phaseError.cause).toBe(errors.get(101));
      expect(detailErrorsOn(repository.raw)).toHaveLength(60);
      expect(detailErrorsOn(repository.enriched)).toHaveLength(60);
      expect(warnings("building.sync.buildinfo_failed")).toHaveLength(60);
      expect(summary()).toEqual({
        event: "building.sync.buildinfo_upserted",
        matched: 0,
        upserted: 0,
        processed: 0,
        errors: 60,
      });
      expect(client.callsOf("spaceList")).toHaveLength(2);
      expect(staleSpacesLeft()).toBe(0);
      expect(buildings.cacheClears).toBe(1);
      expect(infoFields("building.sync.completed")).toBeUndefined();
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it("upserts the rooms of the buildings that succeeded before rejecting at 31 of 60", async () => {
      // Arrange
      healthySkku();
      failBuildInfo((skkuId) => skkuId < 200 || skkuId === 201);

      // Act
      const error = await failureOf(service.run());

      // Assert
      expect((error.errors[0] as Error).message).toBe("buildInfo failed for 31 of 60 buildings");
      const rooms = repository.spaceCdsFrom("buildInfo");
      expect(rooms).toHaveLength(29);
      expect(rooms).not.toContain("201-101");
      expect(rooms).toContain("202-101");
      expect(summary()).toEqual({
        event: "building.sync.buildinfo_upserted",
        matched: 0,
        upserted: 29,
        processed: 29,
        errors: 31,
      });
    });

    it("resolves when exactly half fail", async () => {
      // Arrange
      healthySkku();
      failBuildInfo((skkuId) => skkuId < 200);

      // Act
      const run = service.run();

      // Assert
      await expect(run).resolves.toBeUndefined();
      expect(summary()).toMatchObject({ processed: 30, errors: 30 });
      expect(infoFields("building.sync.completed")).toBeDefined();
    });

    it("names both phases, phase 2 first, when phase 3 fails too", async () => {
      // Arrange
      healthySkku();
      seedStaleSpaces(3);
      failBuildInfo(() => true);
      const spaceListError = new Error("socket hang up");
      client.spaceLists.hssc = spaceListError;

      // Act
      const error = await failureOf(service.run());

      // Assert
      expect(error.message).toBe("Building sync failed in phase 2 (buildInfo) and phase 3 (spaceList)");
      expect((error.errors[0] as Error).message).toBe("buildInfo failed for 60 of 60 buildings");
      expect(error.errors[1]).toBe(spaceListError);
      expect(staleSpacesLeft()).toBe(3);
      expect(buildings.cacheClears).toBe(1);
    });
  });

  describe("phase 2's summary log", () => {
    it("is written on a run that found no rooms, with nothing upserted", async () => {
      // Arrange
      healthySkku();
      client.buildInfo = async () => ({ attachments: [], spaces: [] });

      // Act
      await service.run();

      // Assert
      expect(infoFields("building.sync.buildinfo_upserted")).toEqual({
        event: "building.sync.buildinfo_upserted",
        matched: 0,
        upserted: 0,
        processed: 60,
        errors: 0,
      });
      expect(repository.spaceUpserts).toEqual(["spaceList"]);
    });

    it("is skipped when the rooms' upsert throws, and phase 2 fails", async () => {
      // Arrange
      healthySkku();
      const writeError = new Error("bulk write failed");
      repository.upsertSpacesFailures = [writeError];

      // Act
      const error = await failureOf(service.run());

      // Assert
      expect(error.message).toBe("Building sync failed in phase 2 (buildInfo)");
      expect(error.errors).toEqual([writeError]);
      expect(infoFields("building.sync.buildinfo_upserted")).toBeUndefined();
    });
  });
});
