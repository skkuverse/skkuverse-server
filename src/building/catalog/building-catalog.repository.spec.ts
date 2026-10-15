/**
 * BuildingCatalogRepository's driver calls: each read's filter and projection
 * (which FakeBuildingCatalogRepository follows; the building read is what keeps
 * `sync` out of /building/:skkuId), a building's connections found from either
 * end and read without their _id, parsed so a malformed one is left out and
 * logged (connections are hand-authored), and the boot indexes cover the
 * catalog's reads (a building's spaces by buildNo, a connection from either
 * end). These pin the query objects; what they match against real data is for
 * a mongod spec (harden-test-suite D6).
 */
const find = jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) }));
const findOne = jest.fn((..._args: unknown[]) => Promise.resolve(null));
const createIndex = jest.fn((..._args: unknown[]) => Promise.resolve("ok"));

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../infra/logger", () => mockLogger);

jest.mock("../../infra/db", () => ({
  HOT_READ_MAX_TIME_MS: jest.requireActual("../../infra/db").HOT_READ_MAX_TIME_MS,
  getClient: () => ({
    db: () => ({
      collection: (name: string) => ({
        find,
        findOne,
        createIndex: (...args: unknown[]) => createIndex(name, ...args),
      }),
    }),
  }),
}));

import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import type { BuildNo, SkkuId } from "../building.types";
import { BuildingCatalogRepository } from "./building-catalog.repository";

beforeEach(() => {
  find.mockClear();
  findOne.mockClear();
  mockLogger.warn.mockClear();
});

describe("the reads' projections", () => {
  it("reads one building without its sync bookkeeping or extensions, which the detail would otherwise send", async () => {
    // Act
    await new BuildingCatalogRepository().findBuildingBySkkuId(7 as SkkuId);

    // Assert
    expect(findOne.mock.calls[0]).toEqual([
      { _id: 7 },
      { projection: { sync: 0, enrichVersion: 0, extensions: 0 }, maxTimeMS: HOT_READ_MAX_TIME_MS },
    ]);
  });

  it("reads a building's spaces by buildNo with only the fields the floor list shows", async () => {
    // Act
    await new BuildingCatalogRepository().listSpacesByBuildNo("227" as BuildNo);

    // Assert
    expect(find.mock.calls[0]).toEqual([
      { buildNo: "227" },
      { projection: { _id: 0, spaceCd: 1, name: 1, floor: 1, conspaceCd: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS },
    ]);
  });

  it("reads connection targets by skkuId with only their label fields", async () => {
    // Act
    await new BuildingCatalogRepository().listBuildingsBySkkuIds([1, 2] as SkkuId[]);

    // Assert
    expect(find.mock.calls[0]).toEqual([
      { _id: { $in: [1, 2] } },
      { projection: { _id: 1, buildNo: 1, displayNo: 1, name: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS },
    ]);
  });
});

describe("BuildingCatalogRepository.listConnectionsBySkkuId", () => {
  it("matches either end and reads only the two ends (connections are hand-authored)", async () => {
    // Act
    await new BuildingCatalogRepository().listConnectionsBySkkuId(7 as SkkuId);

    // Assert
    expect(find.mock.calls[0]).toEqual([
      { $or: [{ "a.skkuId": 7 }, { "b.skkuId": 7 }] },
      { projection: { _id: 0, a: 1, b: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS },
    ]);
  });

  it("returns the connections that parse, as stored, and logs the rest once an hour", async () => {
    // Arrange
    const good = { a: { skkuId: 7, floor: { ko: "1층", en: "1F", zh: "1楼" } }, b: { skkuId: 9, floor: { ko: "2층", en: "2F" } } };
    const noFloor = { a: { skkuId: 7 }, b: { skkuId: 9, floor: { ko: "2층", en: "2F" } } };
    const badId = { a: { skkuId: 0, floor: { ko: "1층", en: "1F" } }, b: { skkuId: 7, floor: { ko: "2층", en: "2F" } } };
    find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([good, noFloor, badId]) });
    const repository = new BuildingCatalogRepository();

    // Act
    const connections = await repository.listConnectionsBySkkuId(7 as SkkuId);
    await repository.listConnectionsBySkkuId(7 as SkkuId);

    // Assert
    expect(connections).toEqual([good]);
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn.mock.calls[0]?.[0]).toEqual({
      event: "building.connections.invalid",
      skkuId: 7,
      count: 2,
      invalid: ["#1: a.floor", "#2: a.skkuId"],
      suppressed: 0,
    });
  });
});

describe("BuildingCatalogRepository.ensureIndexes", () => {
  it("indexes a building's spaces and a connection from either end", async () => {
    // Act
    await new BuildingCatalogRepository().ensureIndexes();

    // Assert
    expect(createIndex.mock.calls).toEqual([
      ["spaces", { buildNo: 1 }],
      ["connections", { "a.skkuId": 1 }],
      ["connections", { "b.skkuId": 1 }],
    ]);
  });
});
