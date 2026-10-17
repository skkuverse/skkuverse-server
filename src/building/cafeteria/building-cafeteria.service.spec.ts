/**
 * BuildingCafeteriaService.run() over a scripted client, an in-memory
 * `facilities` repository and a fixed Clock. What it guards:
 *  - the failure contract the poller registry relies on: a campus whose fetch
 *    rejects, or a run that lists no cafeteria at all, rejects and writes
 *    nothing; run() logs no error line itself
 *  - every cafeteria listed is written, stamped with the Clock's time when the
 *    run started, which is also the stale-delete cutoff
 *  - a cafeteria SKKU stopped listing is deleted only when the run listed
 *    enough cafeterias to trust (MIN_CAFETERIAS_FOR_STALE_DELETE)
 * The SKKU payload translation is building-cafeteria.client.spec.ts's, and the
 * exact MongoDB writes are building-cafeteria.repository.spec.ts's.
 */
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../infra/logger", () => mockLogger);

import { FakeBuildingCafeteriaClient } from "../../../__tests__/helpers/fakes/building/building-cafeteria.client.fake";
import { FakeBuildingCafeteriaRepository } from "../../../__tests__/helpers/fakes/building/building-cafeteria.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { Clock } from "../../infra/clock";
import type { BuildNo, Campus } from "../building.types";
import type { BuildingCafeteriaClient } from "./building-cafeteria.client";
import type { SyncedCafeteria } from "./building-cafeteria.document";
import type { BuildingCafeteriaRepository } from "./building-cafeteria.repository";
import { MIN_CAFETERIAS_FOR_STALE_DELETE } from "./building-cafeteria.rules";
import { BuildingCafeteriaService } from "./building-cafeteria.service";

const LAST_SYNC = new Date("2026-10-10T00:00:00Z");
// Far from LAST_SYNC and from the real time, so a run that reads `new Date()` instead of the Clock
// stamps its writes and cuts stale cafeterias at another instant.
const CLOCK_NOW = new Date("2031-03-04T05:06:07.000Z");

function cafeteria(conspaceCd: string, campus: Campus): SyncedCafeteria {
  return {
    _id: conspaceCd,
    kind: "cafeteria",
    campus,
    name: { ko: `식당 ${conspaceCd}`, en: "" },
    buildNo: (campus === "hssc" ? "101" : "203") as BuildNo,
    buildingName: { ko: "건물", en: "" },
    floor: null,
    floorCode: null,
    spaceCd: null,
    location: null,
  };
}

/** `count` cafeterias split across the campuses: hssc 1020xxxx, nsc 2020xxxx. */
function cafeteriasOf(campus: Campus, count: number): SyncedCafeteria[] {
  const prefix = campus === "hssc" ? "1020" : "2020";
  return Array.from({ length: count }, (_, i) => cafeteria(`${prefix}${String(i).padStart(4, "0")}`, campus));
}

let client: FakeBuildingCafeteriaClient;
let repository: FakeBuildingCafeteriaRepository;
let service: BuildingCafeteriaService;

beforeEach(() => {
  jest.clearAllMocks();
  client = new FakeBuildingCafeteriaClient();
  repository = new FakeBuildingCafeteriaRepository();
  const clock = { now: () => CLOCK_NOW } as Clock;
  service = new BuildingCafeteriaService(
    asReal<BuildingCafeteriaClient>(client),
    asReal<BuildingCafeteriaRepository>(repository),
    clock,
  );
});

/** A cafeteria the previous run wrote and SKKU no longer lists. */
function seedClosedCafeteria(): void {
  repository.cafeterias.set("10209999", { ...cafeteria("10209999", "hssc"), syncedAt: LAST_SYNC });
}

describe("BuildingCafeteriaService.run", () => {
  it("writes every cafeteria of both campuses, stamped with the run's start", async () => {
    // Arrange
    client.cafeterias = { hssc: cafeteriasOf("hssc", 4), nsc: cafeteriasOf("nsc", 7) };

    // Act
    await service.run();

    // Assert
    expect(client.calls).toEqual(["hssc", "nsc"]);
    expect([...repository.cafeterias.keys()]).toHaveLength(11);
    expect([...repository.cafeterias.values()].every((c) => c.syncedAt.getTime() === CLOCK_NOW.getTime())).toBe(true);
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("deletes a cafeteria SKKU stopped listing when the run listed enough to trust", async () => {
    // Arrange
    seedClosedCafeteria();
    client.cafeterias = { hssc: cafeteriasOf("hssc", MIN_CAFETERIAS_FOR_STALE_DELETE), nsc: [] };

    // Act
    await service.run();

    // Assert
    expect(repository.cafeterias.has("10209999")).toBe(false);
    expect(repository.cafeterias.size).toBe(MIN_CAFETERIAS_FOR_STALE_DELETE);
  });

  it("keeps a cafeteria SKKU left out of a run too short to trust, and says so", async () => {
    // Arrange
    seedClosedCafeteria();
    client.cafeterias = { hssc: cafeteriasOf("hssc", MIN_CAFETERIAS_FOR_STALE_DELETE - 1), nsc: [] };

    // Act
    await service.run();

    // Assert
    expect(repository.cafeterias.has("10209999")).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { event: "building.cafeteria.stale_delete_skipped", count: MIN_CAFETERIAS_FOR_STALE_DELETE - 1 },
      expect.any(String),
    );
  });

  it("rejects a run that lists no cafeteria, writing and deleting nothing", async () => {
    // Arrange
    seedClosedCafeteria();

    // Act
    const outcome = service.run();

    // Assert
    await expect(outcome).rejects.toThrow("sisulList listed no cafeteria; nothing written");
    expect([...repository.cafeterias.keys()]).toEqual(["10209999"]);
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("rejects with the fetch error when a campus's fetch fails, writing nothing for the other", async () => {
    // Arrange
    const fetchError = new Error("campusMap.do sisulList (nsc) is not the expected shape: buildItems");
    client.cafeterias = { hssc: cafeteriasOf("hssc", 4), nsc: fetchError };

    // Act
    const outcome = service.run();

    // Assert
    await expect(outcome).rejects.toBe(fetchError);
    expect(repository.cafeterias.size).toBe(0);
  });

  it("logs the run's counts when it completes", async () => {
    // Arrange
    seedClosedCafeteria();
    client.cafeterias = { hssc: cafeteriasOf("hssc", 4), nsc: cafeteriasOf("nsc", 7) };

    // Act
    await service.run();

    // Assert
    expect(mockLogger.info).toHaveBeenCalledWith(
      { event: "building.cafeteria.sync_completed", cafeterias: 11, upserted: 11, deleted: 1 },
      expect.any(String),
    );
  });
});
