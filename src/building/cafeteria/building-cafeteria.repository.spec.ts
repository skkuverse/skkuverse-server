/**
 * BuildingCafeteriaRepository's MongoDB operations on `facilities`, pinned
 * literally until a real mongod runs them (ADR 0011, D6): the bulk
 * upsert keyed by conspaceCd with its stamp, and the stale delete's filter,
 * which reaches only cafeterias so another kind of facility a later flow
 * writes is never cut by this one. BuildingCafeteriaService's tests run
 * against an in-memory fake that follows these rules.
 */
const bulkWrite = jest.fn((..._args: unknown[]) => Promise.resolve({}));
const deleteMany = jest.fn((..._args: unknown[]) => Promise.resolve({ deletedCount: 2 }));
const collectionNames: string[] = [];

jest.mock("../../infra/db", () => ({
  getClient: () => ({
    db: () => ({
      collection: (name: string) => {
        collectionNames.push(name);
        return { bulkWrite, deleteMany };
      },
    }),
  }),
}));

import type { BuildNo, SpaceCd } from "../building.types";
import type { SyncedCafeteria } from "./building-cafeteria.document";
import { BuildingCafeteriaRepository } from "./building-cafeteria.repository";

const SYNC_STARTED_AT = new Date("2026-10-17T00:00:00Z");

const FACULTY: SyncedCafeteria = {
  _id: "10201030",
  kind: "cafeteria",
  campus: "hssc",
  name: { ko: "패컬티식당", en: "Faculty Dining Hall" },
  buildNo: "101" as BuildNo,
  buildingName: { ko: "600주년기념관", en: "600th Anniversary Hall" },
  floor: { ko: "6층", en: "6F" },
  floorCode: "06",
  spaceCd: "10607A" as SpaceCd,
  location: { type: "Point", coordinates: [126.994501, 37.587584] },
};

beforeEach(() => {
  bulkWrite.mockClear();
  deleteMany.mockClear();
  collectionNames.length = 0;
});

describe("BuildingCafeteriaRepository.upsertCafeterias", () => {
  it("upserts each cafeteria by its conspaceCd into facilities, every field set and stamped", async () => {
    // Act
    await new BuildingCafeteriaRepository().upsertCafeterias([FACULTY], SYNC_STARTED_AT);

    // Assert
    const { _id, ...fields } = FACULTY;
    expect(collectionNames).toEqual(["facilities"]);
    expect(bulkWrite.mock.calls[0]).toEqual([
      [
        {
          updateOne: {
            filter: { _id },
            update: { $set: { ...fields, syncedAt: SYNC_STARTED_AT } },
            upsert: true,
          },
        },
      ],
      { ordered: false },
    ]);
  });
});

describe("BuildingCafeteriaRepository.deleteCafeteriasSyncedBefore", () => {
  it("deletes only cafeterias stamped before the cutoff, and counts them", async () => {
    // Act
    const deleted = await new BuildingCafeteriaRepository().deleteCafeteriasSyncedBefore(SYNC_STARTED_AT);

    // Assert
    expect(collectionNames).toEqual(["facilities"]);
    expect(deleteMany.mock.calls[0]).toEqual([{ kind: "cafeteria", syncedAt: { $lt: SYNC_STARTED_AT } }]);
    expect(deleted).toBe(2);
  });
});
