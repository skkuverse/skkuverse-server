const mockCollections: Record<string, { bulkWrite: jest.Mock; createIndex: jest.Mock }> = {};
const mockCollection = (name: string) =>
  (mockCollections[name] ??= {
    bulkWrite: jest.fn().mockResolvedValue({}),
    createIndex: jest.fn().mockResolvedValue("ok"),
  });

jest.mock("../../infra/db", () => ({
  getClient: () => ({ db: () => ({ collection: mockCollection }) }),
}));

jest.mock("../../infra/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import type { BuildingRawDoc } from "../building.document";
import type { BuildNo, SkkuId, SpaceCd } from "../building.types";
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
    await new BuildingSyncRepository().upsertEnriched(
      [{ skkuId: RAW._id, building: enrichBuilding(RAW) }],
      SYNC_STARTED_AT,
    );
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
    const repository = new BuildingSyncRepository();
    await repository.upsertSpaces([SPACE], "buildInfo", SYNC_STARTED_AT);
    await repository.upsertSpaces([SPACE], "spaceList", SYNC_STARTED_AT);
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

describe("BuildingSyncRepository indexes", () => {
  it("owns the unique space key its upserts filter on and the raw layer's campus", async () => {
    await new BuildingSyncRepository().ensureIndexes();
    expect(mockCollections.spaces!.createIndex.mock.calls).toEqual([
      [{ spaceCd: 1, buildNo: 1, campus: 1 }, { unique: true }],
    ]);
    expect(mockCollections.buildings_raw!.createIndex.mock.calls).toEqual([[{ campus: 1 }]]);
  });

  it("owns the 2dsphere that guards the enriched location it writes", async () => {
    await new BuildingSyncRepository().ensureIndexes();
    expect(mockCollections.buildings!.createIndex.mock.calls).toEqual([[{ location: "2dsphere" }]]);
  });
});
