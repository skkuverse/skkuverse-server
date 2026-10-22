/**
 * BuildingSyncRepository's MongoDB operations, pinned literally until a real
 * mongod runs them (ADR 0011, D6): the bulk upserts' dot paths and
 * stamps, which layers each write reaches, the best-effort failure note, the
 * stale-space delete's filter, and the indexes this repository owns.
 * BuildingSyncService's tests run against an in-memory fake that follows
 * these rules; this file is where the rules meet the driver.
 */
type MockCollection = {
  bulkWrite: jest.Mock;
  createIndex: jest.Mock;
  updateOne: jest.Mock;
  deleteMany: jest.Mock;
  find: jest.Mock;
};
const mockCollections: Record<string, MockCollection> = {};
const mockCollection = (name: string) =>
  (mockCollections[name] ??= {
    bulkWrite: jest.fn().mockResolvedValue({}),
    createIndex: jest.fn().mockResolvedValue("ok"),
    updateOne: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
    find: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) })),
  });

jest.mock("../../infra/db", () => ({
  getClient: () => ({ db: () => ({ collection: mockCollection }) }),
}));

jest.mock("../../infra/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import logger from "../../infra/logger";
import type { BuildingRawDoc } from "../building.document";
import type { BuildNo, SkkuId, SpaceCd } from "../building.types";
import type { ApiId } from "./building-sync.types";
import { enrichBuilding } from "./building-sync.mapper";
import { BuildingSyncRepository } from "./building-sync.repository";
import type { SyncedSpace } from "./building-sync.types";

const SYNC_STARTED_AT = new Date("2026-10-10T00:00:00Z");

const RAW: BuildingRawDoc = {
  _id: 2 as SkkuId,
  buildNo: "248" as BuildNo,
  campus: "hssc",
  name: { ko: "법학관", en: "" },
  description: {
    ko: "법학관 소개\n\n* 배리어프리 편의시설 안내\n경사로 : O (정문)\n장애인 화장실 : 총 2개\n장애인 표시 승강기 : 3대 중 2대\n승강기 기능 상태 : 음성 안내 없음\n장애인 주차장 : 4면",
    en: "Law",
  },
  location: { type: "Point", coordinates: [126.99, 37.58] },
  image: { url: "https://x/a.jpg", filename: "a.jpg" },
  accessibility: { elevator: true, toilet: false },
  skkuCreatedAt: "2020-01-01",
  skkuUpdatedAt: "2024-01-01",
};

const SPACE: SyncedSpace = {
  spaceCd: "248101" as SpaceCd,
  buildNo: "248" as BuildNo,
  campus: "hssc",
  floor: { ko: "1층", en: "1F" },
  name: { ko: "강의실", en: "" },
  buildingName: { ko: "법학관", en: "Law" },
  conspaceCd: "C1",
};

beforeEach(() => {
  for (const name of Object.keys(mockCollections)) delete mockCollections[name];
});

/**
 * The exact bulk operations the sync writes. Dot paths ("name.ko") update a
 * nested field without replacing its siblings; a whole-object `$set` would
 * drop them, so these shapes are pinned literally.
 */
describe("BuildingSyncRepository writes", () => {
  it("upserts an enriched building with dot-path fields and the sync stamps", async () => {
    // Act
    await new BuildingSyncRepository().upsertEnriched(
      [{ skkuId: RAW._id, building: enrichBuilding(RAW) }],
      SYNC_STARTED_AT,
    );

    // Assert
    expect(mockCollections.buildings!.bulkWrite).toHaveBeenCalledWith(
      [
        {
          updateOne: {
            filter: { _id: 2 },
            update: {
              $set: {
                buildNo: "248",
                displayNo: "248",
                type: "building",
                campus: "hssc",
                "name.ko": "법학관",
                "name.en": "",
                "description.ko": "법학관 소개",
                "description.en": "Law",
                location: { type: "Point", coordinates: [126.99, 37.58] },
                image: { url: "https://x/a.jpg", filename: "a.jpg" },
                attachments: [],
                "accessibility.elevator": true,
                "accessibility.toilet": false,
                "accessibility.detail": {
                  sections: [
                    {
                      label: null,
                      ramp: { available: true, note: "정문" },
                      toilet: { raw: "총 2개", count: 2 },
                      elevator: { raw: "3대 중 2대", total: 3, accessible: 2 },
                      elevatorStatus: "none",
                      parking: 4,
                    },
                  ],
                },
                enrichVersion: 1,
                skkuCreatedAt: "2020-01-01",
                skkuUpdatedAt: "2024-01-01",
                "sync.listAt": SYNC_STARTED_AT,
                updatedAt: SYNC_STARTED_AT,
              },
              $setOnInsert: { extensions: {} },
            },
            upsert: true,
          },
        },
      ],
      { ordered: false },
    );
  });

  it("upserts a buildInfo space without touching conspaceCd, and a spaceList space with it", async () => {
    // Arrange
    const repository = new BuildingSyncRepository();

    // Act
    await repository.upsertSpaces([SPACE], "buildInfo", SYNC_STARTED_AT);
    await repository.upsertSpaces([SPACE], "spaceList", SYNC_STARTED_AT);

    // Assert
    const filter = { spaceCd: "248101", buildNo: "248", campus: "hssc" };
    const names = {
      floor: { ko: "1층", en: "1F" },
      name: { ko: "강의실", en: "" },
      buildingName: { ko: "법학관", en: "Law" },
    };
    expect(mockCollections.spaces!.bulkWrite.mock.calls).toEqual([
      [
        [
          {
            updateOne: {
              filter,
              update: {
                $set: { ...names, syncedAt: SYNC_STARTED_AT },
                $addToSet: { sources: "buildInfo" },
                $setOnInsert: { conspaceCd: null },
              },
              upsert: true,
            },
          },
        ],
        { ordered: false },
      ],
      [
        [
          {
            updateOne: {
              filter,
              update: {
                $set: { ...names, conspaceCd: "C1", syncedAt: SYNC_STARTED_AT },
                $addToSet: { sources: "spaceList" },
              },
              upsert: true,
            },
          },
        ],
        { ordered: false },
      ],
    ]);
  });
});

describe("BuildingSyncRepository raw and detail writes", () => {
  const LISTED = { skkuId: RAW._id, apiId: 2 as ApiId, doc: (({ _id, ...doc }) => doc)(RAW) };
  const ATTACHMENTS = [{ id: 12, url: "https://www.skku.edu/a.jpg", filename: "P2.jpg", alt: "" }];

  it("upserts a listed building's raw layer by skkuId with the list stamp", async () => {
    // Act
    await new BuildingSyncRepository().upsertRaw([LISTED], SYNC_STARTED_AT);

    // Assert
    expect(mockCollections.buildings_raw!.bulkWrite).toHaveBeenCalledWith(
      [
        {
          updateOne: {
            filter: { _id: 2 },
            update: { $set: { ...LISTED.doc, "sync.listAt": SYNC_STARTED_AT } },
            upsert: true,
          },
        },
      ],
      { ordered: false },
    );
  });

  it("writes a building's photos to both layers and clears its detail error", async () => {
    // Act
    await new BuildingSyncRepository().setAttachments(RAW._id, ATTACHMENTS, SYNC_STARTED_AT);

    // Assert
    const update = { $set: { attachments: ATTACHMENTS, "sync.detailAt": SYNC_STARTED_AT, "sync.detailError": null } };
    expect(mockCollections.buildings_raw!.updateOne.mock.calls).toEqual([[{ _id: 2 }, update]]);
    expect(mockCollections.buildings!.updateOne.mock.calls).toEqual([[{ _id: 2 }, update]]);
  });

  it("notes a failed buildInfo on both layers", async () => {
    // Act
    await new BuildingSyncRepository().recordDetailError(RAW._id, "HTTP 502");

    // Assert
    const update = { $set: { "sync.detailError": "HTTP 502" } };
    expect(mockCollections.buildings_raw!.updateOne.mock.calls).toEqual([[{ _id: 2 }, update]]);
    expect(mockCollections.buildings!.updateOne.mock.calls).toEqual([[{ _id: 2 }, update]]);
  });

  it.each([
    ["buildings_raw", "buildings"],
    ["buildings", "buildings_raw"],
  ])("logs a failure note it cannot write on %s, still writes %s, and resolves", async (failing, other) => {
    // Arrange
    (logger.warn as jest.Mock).mockClear();
    const noteError = new Error("not primary");
    mockCollection(failing).updateOne.mockRejectedValueOnce(noteError);

    // Act
    const note = new BuildingSyncRepository().recordDetailError(RAW._id, "HTTP 502");

    // Assert
    await expect(note).resolves.toBeUndefined();
    expect(mockCollection(other).updateOne).toHaveBeenCalledWith({ _id: 2 }, { $set: { "sync.detailError": "HTTP 502" } });
    expect(logger.warn).toHaveBeenCalledWith(
      { event: "building.sync.error_note_failed", skkuId: 2, err: noteError },
      expect.any(String),
    );
  });
});

describe("BuildingSyncRepository reads and the stale delete", () => {
  it("deletes the spaces stamped before this run and reports how many", async () => {
    // Arrange
    mockCollection("spaces").deleteMany.mockResolvedValueOnce({ deletedCount: 44 });

    // Act
    const deleted = await new BuildingSyncRepository().deleteSpacesSyncedBefore(SYNC_STARTED_AT);

    // Assert
    expect(deleted).toBe(44);
    expect(mockCollections.spaces!.deleteMany).toHaveBeenCalledWith({ syncedAt: { $lt: SYNC_STARTED_AT } });
  });

  it("finds the enriched buildings written at any other enrich version", async () => {
    // Arrange
    mockCollection("buildings").find.mockReturnValueOnce({
      toArray: jest.fn().mockResolvedValue([{ _id: 2 }, { _id: 7 }]),
    });

    // Act
    const stale = await new BuildingSyncRepository().listSkkuIdsNotEnrichedAt(3);

    // Assert
    expect(stale).toEqual(new Set([2, 7]));
    expect(mockCollections.buildings!.find).toHaveBeenCalledWith(
      { enrichVersion: { $ne: 3 } },
      expect.objectContaining({ projection: { _id: 1 } }),
    );
  });

  it("maps each raw building to the update stamp SKKU last gave it", async () => {
    // Arrange
    mockCollection("buildings_raw").find.mockReturnValueOnce({
      toArray: jest.fn().mockResolvedValue([
        { _id: 2, skkuUpdatedAt: "2024-01-01" },
        { _id: 7, skkuUpdatedAt: null },
      ]),
    });

    // Act
    const stamps = await new BuildingSyncRepository().listRawUpdatedAt();

    // Assert
    expect(stamps).toEqual(new Map([[2, "2024-01-01"], [7, null]]));
    expect(mockCollections.buildings_raw!.find).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ projection: { skkuUpdatedAt: 1 } }),
    );
  });

  it("reads the raw buildings of the given skkuIds, whole, under the sync's read bound", async () => {
    // Arrange
    mockCollection("buildings_raw").find.mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([RAW]) });

    // Act
    const raw = await new BuildingSyncRepository().listRawBySkkuIds(new Set([2 as SkkuId, 7 as SkkuId]));

    // Assert
    expect(raw).toEqual([RAW]);
    expect(mockCollections.buildings_raw!.find.mock.calls).toEqual([[{ _id: { $in: [2, 7] } }, { maxTimeMS: 30_000 }]]);
  });
});

describe("BuildingSyncRepository.onModuleInit", () => {
  it("owns the unique space key its upserts filter on, and no index on the raw layer", async () => {
    // Act
    await new BuildingSyncRepository().onModuleInit();

    // Assert
    expect(mockCollections.spaces!.createIndex.mock.calls).toEqual([
      [{ spaceCd: 1, buildNo: 1, campus: 1 }, { unique: true }],
    ]);
    // No query reads buildings_raw by campus; $indexStats showed 0 ops on campus_1 (2026-10-10).
    const indexed = Object.entries(mockCollections)
      .filter(([, collection]) => collection.createIndex.mock.calls.length > 0)
      .map(([name]) => name);
    expect(indexed.sort()).toEqual(["buildings", "spaces"]);
  });

  it("owns the 2dsphere that guards the enriched location it writes", async () => {
    // Act
    await new BuildingSyncRepository().onModuleInit();

    // Assert
    expect(mockCollections.buildings!.createIndex.mock.calls).toEqual([[{ location: "2dsphere" }]]);
  });

  it("logs that the indexes are ensured", async () => {
    // Arrange
    (logger.info as jest.Mock).mockClear();

    // Act
    await new BuildingSyncRepository().onModuleInit();

    // Assert
    expect(logger.info).toHaveBeenCalledWith({ event: "building.sync.indexes.ensured" }, expect.any(String));
  });

  it("warns and carries on when an index cannot be created", async () => {
    // Arrange
    (logger.warn as jest.Mock).mockClear();
    mockCollection("spaces").createIndex.mockRejectedValueOnce(new Error("atlas down"));

    // Act & Assert
    await expect(new BuildingSyncRepository().onModuleInit()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "building.sync.indexes.failed" }),
      expect.any(String),
    );
  });
});
