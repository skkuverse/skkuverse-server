/**
 * BuildingCatalogRepository's driver calls: each read's filter and projection
 * (which FakeBuildingCatalogRepository follows; the building read's projection
 * and parse are what keep the writer's `sync` out of /building/:skkuId), and
 * each read parsed so a malformed document is left out and logged, at most
 * hourly: buildings, spaces and cafeterias (skkuverse-crawler writes them) and
 * connections (hand-authored); a building's displayNo is derived from its
 * buildNo. A building's connections are found from either end and read
 * without their _id, and the boot indexes cover the
 * catalog's reads (a building's spaces by buildNo, a connection from either
 * end, a building's cafeterias by buildNo). These pin the query objects; what they match against real data is for
 * a mongod spec (ADR 0011, D6).
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

import { storedBuilding } from "../../../__tests__/helpers/building/buildings";
import { storedFacilities } from "../../../__tests__/helpers/building/facilities";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import type { BuildNo, SkkuId } from "../building.types";
import { BuildingCatalogRepository } from "./building-catalog.repository";

beforeEach(() => {
  find.mockClear();
  findOne.mockClear();
  mockLogger.warn.mockClear();
});

describe("the reads' projections", () => {
  it("reads one building with only the fields the detail serves, never the writer's bookkeeping", async () => {
    // Act
    await new BuildingCatalogRepository().findBuildingBySkkuId(7 as SkkuId);

    // Assert
    expect(findOne.mock.calls[0]).toEqual([
      { _id: 7 },
      {
        projection: {
          _id: 1,
          buildNo: 1,
          type: 1,
          campus: 1,
          name: 1,
          description: 1,
          location: 1,
          image: 1,
          attachments: 1,
          accessibility: 1,
          skkuCreatedAt: 1,
          skkuUpdatedAt: 1,
          updatedAt: 1,
        },
        maxTimeMS: HOT_READ_MAX_TIME_MS,
      },
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

  it("reads connection targets by skkuId with only their label fields, and the campus their displayNo derives from", async () => {
    // Act
    await new BuildingCatalogRepository().listBuildingsBySkkuIds([1, 2] as SkkuId[]);

    // Assert
    expect(find.mock.calls[0]).toEqual([
      { _id: { $in: [1, 2] } },
      { projection: { _id: 1, buildNo: 1, campus: 1, name: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS },
    ]);
  });
});

describe("BuildingCatalogRepository parses the buildings and spaces the crawler wrote", () => {
  const LAW = storedBuilding({ _id: 3, buildNo: "102", campus: "hssc", name: { ko: "법학관", en: "Law School" } });

  it("returns a building that parses with its displayNo derived, and drops the writer's bookkeeping", async () => {
    // Arrange
    findOne.mockResolvedValueOnce({ ...LAW, displayNo: "stale", sync: { listAt: new Date(0) } } as never);

    // Act
    const building = await new BuildingCatalogRepository().findBuildingBySkkuId(3 as SkkuId);

    // Assert
    expect(building).toEqual(LAW);
    expect(building?.displayNo).toBe("2");
  });

  it("treats a building that does not parse as missing, and logs it once an hour", async () => {
    // Arrange
    findOne.mockResolvedValueOnce({ ...LAW, image: null } as never).mockResolvedValueOnce({ ...LAW, image: null } as never);
    const repository = new BuildingCatalogRepository();

    // Act
    const building = await repository.findBuildingBySkkuId(3 as SkkuId);
    await repository.findBuildingBySkkuId(3 as SkkuId);

    // Assert
    expect(building).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn.mock.calls[0]?.[0]).toEqual({
      event: "building.buildings.invalid",
      skkuId: 3,
      count: 1,
      invalid: ["3: image"],
      suppressed: 0,
    });
  });

  it("returns the spaces that parse, and logs the rest by spaceCd", async () => {
    // Arrange
    const space = { spaceCd: "2B101", name: { ko: "강의실", en: "" }, floor: { ko: "지하1층", en: "B1" }, conspaceCd: null };
    find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([space, { ...space, spaceCd: "2B102", floor: null }]) });

    // Act
    const spaces = await new BuildingCatalogRepository().listSpacesByBuildNo("102" as BuildNo);

    // Assert
    expect(spaces).toEqual([space]);
    expect(mockLogger.warn.mock.calls[0]?.[0]).toMatchObject({ event: "building.spaces.invalid", buildNo: "102", invalid: ["2B102: floor"] });
  });

  it("labels each connection target with its displayNo derived, and leaves out one that does not parse", async () => {
    // Arrange
    const label = { _id: 3, buildNo: "102", campus: "hssc", name: { ko: "법학관", en: "Law School" } };
    find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([label, { ...label, _id: 4, name: "법학관" }]) });

    // Act
    const labels = await new BuildingCatalogRepository().listBuildingsBySkkuIds([3, 4] as SkkuId[]);

    // Assert
    expect(labels).toEqual([{ _id: 3, buildNo: "102", displayNo: "2", name: { ko: "법학관", en: "Law School" } }]);
    expect(mockLogger.warn.mock.calls[0]?.[0]).toMatchObject({ event: "building.buildings.invalid", skkuIds: [3, 4], invalid: ["4: name"] });
  });
});

describe("BuildingCatalogRepository.listCafeteriasByBuildNo", () => {
  it("reads a building's cafeterias by buildNo, in conspaceCd order, with only the fields the detail shows", async () => {
    // Act
    await new BuildingCatalogRepository().listCafeteriasByBuildNo("101" as BuildNo);

    // Assert
    expect(find.mock.calls[0]).toEqual([
      { buildNo: "101", kind: "cafeteria" },
      { projection: { _id: 1, name: 1, floor: 1, spaceCd: 1 }, sort: { _id: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS },
    ]);
  });
});

describe("BuildingCatalogRepository.listCafeteriasByBuildNo parses what the crawler wrote", () => {
  it("returns the cafeterias that parse as their summary, and logs the rest once an hour", async () => {
    // Arrange
    const [faculty] = storedFacilities().cafeterias;
    const noName = { ...faculty, _id: "10201031", name: undefined };
    const emptySpace = { ...faculty, _id: "10201033", spaceCd: "" };
    find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([faculty, noName, emptySpace]) });
    const repository = new BuildingCatalogRepository();

    // Act
    const cafeterias = await repository.listCafeteriasByBuildNo("101" as BuildNo);
    await repository.listCafeteriasByBuildNo("101" as BuildNo);

    // Assert
    expect(cafeterias).toEqual([
      { _id: "10201030", name: { ko: "패컬티식당", en: "Faculty Dining Hall" }, floor: { ko: "6층", en: "6F" }, spaceCd: "10607A" },
    ]);
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn.mock.calls[0]?.[0]).toEqual({
      event: "building.cafeterias.invalid",
      buildNo: "101",
      count: 2,
      invalid: ["10201031: name", "10201033: spaceCd"],
      suppressed: 0,
    });
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

describe("BuildingCatalogRepository.onModuleInit", () => {
  beforeEach(() => {
    createIndex.mockClear();
    mockLogger.info.mockClear();
  });

  it("indexes a building's spaces, a connection from either end and a building's cafeterias", async () => {
    // Act
    await new BuildingCatalogRepository().onModuleInit();

    // Assert
    expect(createIndex.mock.calls).toEqual([
      ["spaces", { buildNo: 1 }],
      ["connections", { "a.skkuId": 1 }],
      ["connections", { "b.skkuId": 1 }],
      ["facilities", { buildNo: 1 }],
    ]);
    expect(mockLogger.info).toHaveBeenCalledWith({ event: "building.catalog.indexes.ensured" }, expect.any(String));
  });

  it("warns and carries on when an index cannot be created", async () => {
    // Arrange
    createIndex.mockRejectedValueOnce(new Error("atlas down"));

    // Act & Assert
    await expect(new BuildingCatalogRepository().onModuleInit()).resolves.toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "building.catalog.indexes.failed" }),
      expect.any(String),
    );
  });
});
