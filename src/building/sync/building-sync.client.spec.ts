/**
 * BuildingSyncClient against SKKU's campusMap.do as it answered on 2026-10-10
 * (captured, trimmed fixtures; see each file's `_about`). What it guards: the
 * request each mode sends, and the translation of SKKU's field names into the
 * raw building, attachment and space shapes, including the cases the real
 * payloads carry: a facility with an empty or missing buildNo, accessibility
 * flags other than "Y", and a space whose English name is missing. And the
 * schema at the boundary: an item that does not match is left out and logged,
 * while a response of the wrong shape, or with more than half its items
 * invalid, rejects.
 */
import fs from "fs";
import path from "path";

const mockGet = jest.fn();
jest.mock("axios", () => ({ get: mockGet }));
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../infra/logger", () => mockLogger);

import { BuildingSyncClient } from "./building-sync.client";
import type { ListedBuildingWithBuildNo } from "./building-sync.types";

const CAMPUS_MAP_URL = "https://www.skku.edu/skku/about/campusInfo/campusMap.do";
const fixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "../../../__tests__/nest/building/fixtures", name), "utf8"));
const BUILD_LIST = fixture("campus-map-buildlist-hssc.json");
const BUILD_INFO = fixture("campus-map-buildinfo-101.json");
const SPACE_LIST = fixture("campus-map-spacelist-hssc.json");

const client = new BuildingSyncClient();

beforeEach(() => {
  mockGet.mockReset();
  mockLogger.warn.mockReset();
});

/** A copy of `item` without `key`, as a payload that dropped the field would send it. */
function without(item: object, key: string): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...(item as Record<string, unknown>) };
  delete copy[key];
  return copy;
}

const DROPPED = "SKKU payload items left out: they do not match the schema";

describe("BuildingSyncClient.fetchBuildList", () => {
  it("asks for one campus's buildList", async () => {
    // Arrange
    mockGet.mockResolvedValue({ data: BUILD_LIST });

    // Act
    await client.fetchBuildList("hssc");

    // Assert
    expect(mockGet).toHaveBeenCalledWith(CAMPUS_MAP_URL, {
      params: { mode: "buildList", srSearchValue: "", campusCd: "1" },
      timeout: 30000,
    });
  });

  it("translates a building into the raw layer", async () => {
    // Arrange
    mockGet.mockResolvedValue({ data: BUILD_LIST });

    // Act
    const [anniversaryHall] = await client.fetchBuildList("hssc");

    // Assert
    expect(anniversaryHall).toEqual({
      skkuId: 2,
      apiId: 2,
      doc: {
        buildNo: "101",
        campus: "hssc",
        name: { ko: "600주년기념관", en: "600th Anniversary Hall" },
        description: { ko: BUILD_LIST.buildItems[0].krText, en: BUILD_LIST.buildItems[0].enText },
        location: { type: "Point", coordinates: [126.994479, 37.587361] },
        image: {
          url: "https://www.skku.edu/_attach/image/2018/07/WdvZbhwLWznIHxqgvdLQ.jpg",
          filename: "WdvZbhwLWznIHxqgvdLQ.jpg",
        },
        accessibility: { elevator: true, toilet: true },
        skkuCreatedAt: "2018-04-23T00:34:12.000+00:00",
        skkuUpdatedAt: "2021-03-25T02:38:41.000+00:00",
      },
    });
  });

  it("reads an accessibility flag other than Y as false", async () => {
    // Arrange
    mockGet.mockResolvedValue({ data: BUILD_LIST });

    // Act
    const facultyHall = (await client.fetchBuildList("hssc"))[1]!;

    // Assert
    expect(facultyHall.doc.accessibility).toEqual({ elevator: false, toilet: false });
  });

  it("gives a facility with an empty or missing buildNo a null one", async () => {
    // Arrange
    mockGet.mockResolvedValue({ data: BUILD_LIST });

    // Act
    const [, , backGate, mainGate] = await client.fetchBuildList("hssc");

    // Assert
    expect(backGate).toMatchObject({ skkuId: 45, doc: { buildNo: null, name: { ko: "후문", en: "Back Gate" } } });
    expect(mainGate).toMatchObject({ skkuId: 1, doc: { buildNo: null, name: { ko: "정문", en: "Main Gate" } } });
  });

  it("rejects a body without buildItems as the wrong shape", async () => {
    // Arrange
    mockGet.mockResolvedValue({ data: {} });

    // Act & Assert
    await expect(client.fetchBuildList("nsc")).rejects.toThrow(
      "campusMap.do buildList (nsc) is not the expected shape: buildItems",
    );
  });
});

describe("BuildingSyncClient.fetchBuildInfo", () => {
  async function anniversaryHall(): Promise<ListedBuildingWithBuildNo> {
    mockGet.mockResolvedValueOnce({ data: BUILD_LIST });
    const [building] = await client.fetchBuildList("hssc");
    return building as ListedBuildingWithBuildNo;
  }

  it("asks for the building by buildNo and SKKU's id", async () => {
    // Arrange
    const building = await anniversaryHall();
    mockGet.mockResolvedValueOnce({ data: BUILD_INFO });

    // Act
    await client.fetchBuildInfo(building);

    // Assert
    expect(mockGet).toHaveBeenLastCalledWith(CAMPUS_MAP_URL, {
      params: { mode: "buildInfo", buildNo: "101", id: 2 },
      timeout: 30000,
    });
  });

  it("translates the photos and the floor spaces, naming each space's building", async () => {
    // Arrange
    const building = await anniversaryHall();
    mockGet.mockResolvedValueOnce({ data: BUILD_INFO });

    // Act
    const { attachments, spaces } = await client.fetchBuildInfo(building);

    // Assert
    expect(attachments).toEqual([
      {
        id: 12,
        url: "https://www.skku.edu/_attach/image/2018/07/WdvZbhwLWznIHxqgvdLQ.jpg",
        filename: "P2.jpg",
        alt: "",
      },
    ]);
    const hall = { ko: "600주년기념관", en: "600th Anniversary Hall" };
    expect(spaces).toEqual([
      { spaceCd: "10101", buildNo: "101", campus: "hssc", floor: { ko: "1층", en: "1F" }, name: { ko: "입학자료실", en: "Reference Room" }, buildingName: hall, conspaceCd: null },
      { spaceCd: "10102", buildNo: "101", campus: "hssc", floor: { ko: "1층", en: "1F" }, name: { ko: "금고실", en: "Vault" }, buildingName: hall, conspaceCd: null },
      { spaceCd: "10106", buildNo: "101", campus: "hssc", floor: { ko: "1층", en: "1F" }, name: { ko: "재무팀", en: "" }, buildingName: hall, conspaceCd: null },
    ]);
  });

  it("reads SKKU's literal \"undefined\" English space name as empty", async () => {
    // Arrange
    // Not in the 2026-10-10 capture; SKKU has sent the string before.
    const building = await anniversaryHall();
    const [first] = BUILD_INFO.floorItem;
    mockGet.mockResolvedValueOnce({ data: { attachItem: [], floorItem: [{ ...first, spcae_nm_eng: "undefined" }] } });

    // Act
    const { spaces } = await client.fetchBuildInfo(building);

    // Assert
    expect(spaces[0]!.name).toEqual({ ko: "입학자료실", en: "" });
  });
});

describe("BuildingSyncClient.fetchSpaceList", () => {
  it("asks for one campus's spaceList", async () => {
    // Arrange
    mockGet.mockResolvedValue({ data: SPACE_LIST });

    // Act
    await client.fetchSpaceList("hssc");

    // Assert
    expect(mockGet).toHaveBeenCalledWith(CAMPUS_MAP_URL, {
      params: { mode: "spaceList", srSearchValue: "", campusCd: "1" },
      timeout: 30000,
    });
  });

  it("translates each space, its building's name and its conspaceCd, with the campus it was asked for", async () => {
    // Arrange
    mockGet.mockResolvedValue({ data: SPACE_LIST });

    // Act
    const spaces = await client.fetchSpaceList("hssc");

    // Assert
    const hall = { ko: "600주년기념관", en: "600th Anniversary Hall" };
    expect(spaces).toEqual([
      { spaceCd: "10101", buildNo: "101", campus: "hssc", floor: { ko: "1층", en: "1F" }, name: { ko: "입학자료실", en: "Reference Room" }, buildingName: hall, conspaceCd: "10101001" },
      { spaceCd: "10102", buildNo: "101", campus: "hssc", floor: { ko: "1층", en: "1F" }, name: { ko: "금고실", en: "Vault" }, buildingName: hall, conspaceCd: "10101002" },
      { spaceCd: "10106", buildNo: "101", campus: "hssc", floor: { ko: "1층", en: "1F" }, name: { ko: "재무팀", en: "" }, buildingName: hall, conspaceCd: "10101006" },
    ]);
  });
});

/**
 * The schema at the boundary (stage 6 of the building review). Today's real
 * payloads carry one invalid item: a spaceList row per campus with no spaceCd
 * and no name, which reached /building/2 and /building/31 as a blank room.
 */
describe("BuildingSyncClient payload validation", () => {
  /** The hssc junk row from the 2026-10-10 capture, verbatim. */
  const JUNK_SPACE_ROW = {
    m: 1,
    buildNo: "101",
    buildNm: "600주년기념관",
    buildNmEng: "600th Anniversary Hall",
    floorNm: "1층",
    floorNmEng: "1F",
    latitude: 37.587272,
    longtitude: 126.994455,
    conspaceCd: "10104024",
  };

  it("logs nothing for a payload that matches", async () => {
    // Arrange
    mockGet.mockResolvedValue({ data: BUILD_LIST });

    // Act
    await client.fetchBuildList("hssc");

    // Assert
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("leaves out a building without an id, keyed by its index, and maps the rest as before", async () => {
    // Arrange
    const [, facultyHall] = BUILD_LIST.buildItems;
    mockGet.mockResolvedValue({ data: { buildItems: [...BUILD_LIST.buildItems, without(facultyHall, "id")] } });

    // Act
    const buildings = await client.fetchBuildList("hssc");

    // Assert
    expect(buildings.map((b) => b.skkuId)).toStrictEqual([2, 4, 45, 1]);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { event: "building.sync.payload_items_dropped", source: "buildList", scope: "hssc", dropped: 1, total: 5, invalid: ["#4: id"] },
      DROPPED,
    );
  });

  it("leaves out a building whose coordinates do not parse, keyed by its id", async () => {
    // Arrange
    const [, facultyHall] = BUILD_LIST.buildItems;
    mockGet.mockResolvedValue({ data: { buildItems: [...BUILD_LIST.buildItems, { ...facultyHall, id: 99, latitude: "abc" }] } });

    // Act
    const buildings = await client.fetchBuildList("hssc");

    // Assert
    expect(buildings.map((b) => b.skkuId)).toStrictEqual([2, 4, 45, 1]);
    expect(mockLogger.warn.mock.calls[0]![0]).toMatchObject({ dropped: 1, total: 5, invalid: ["99: latitude"] });
  });

  it("rejects a buildList with more than half its items invalid, after logging them", async () => {
    // Arrange
    const [anniversaryHall, facultyHall, backGate, mainGate] = BUILD_LIST.buildItems;
    mockGet.mockResolvedValue({
      data: {
        buildItems: [anniversaryHall, without(facultyHall, "id"), { ...backGate, buildNm: "" }, { ...mainGate, longtitude: "x" }],
      },
    });

    // Act
    const fetch = client.fetchBuildList("hssc");

    // Assert
    await expect(fetch).rejects.toThrow("campusMap.do buildList (hssc) returned 3 invalid items of 4");
    expect(mockLogger.warn).toHaveBeenCalledWith(
      {
        event: "building.sync.payload_items_dropped",
        source: "buildList",
        scope: "hssc",
        dropped: 3,
        total: 4,
        invalid: ["#1: id", "45: buildNm", "1: longtitude"],
      },
      DROPPED,
    );
  });

  it("keeps a buildList with exactly half its items invalid", async () => {
    // Arrange
    const [anniversaryHall, facultyHall, backGate, mainGate] = BUILD_LIST.buildItems;
    mockGet.mockResolvedValue({ data: { buildItems: [anniversaryHall, facultyHall, without(backGate, "id"), without(mainGate, "id")] } });

    // Act
    const buildings = await client.fetchBuildList("hssc");

    // Assert
    expect(buildings.map((b) => b.skkuId)).toStrictEqual([2, 4]);
  });

  it("leaves out the spaceList junk row and maps the real spaces as before", async () => {
    // Arrange
    mockGet.mockResolvedValue({ data: { items: [...SPACE_LIST.items, JUNK_SPACE_ROW] } });

    // Act
    const spaces = await client.fetchSpaceList("hssc");

    // Assert
    const hall = { ko: "600주년기념관", en: "600th Anniversary Hall" };
    expect(spaces).toStrictEqual([
      { spaceCd: "10101", buildNo: "101", campus: "hssc", floor: { ko: "1층", en: "1F" }, name: { ko: "입학자료실", en: "Reference Room" }, buildingName: hall, conspaceCd: "10101001" },
      { spaceCd: "10102", buildNo: "101", campus: "hssc", floor: { ko: "1층", en: "1F" }, name: { ko: "금고실", en: "Vault" }, buildingName: hall, conspaceCd: "10101002" },
      { spaceCd: "10106", buildNo: "101", campus: "hssc", floor: { ko: "1층", en: "1F" }, name: { ko: "재무팀", en: "" }, buildingName: hall, conspaceCd: "10101006" },
    ]);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { event: "building.sync.payload_items_dropped", source: "spaceList", scope: "hssc", dropped: 1, total: 4, invalid: ["#3: spaceCd"] },
      DROPPED,
    );
  });

  it("logs at most ten invalid items, while counting every one dropped", async () => {
    // Arrange
    const [space] = SPACE_LIST.items;
    const valid = Array.from({ length: 30 }, (_, i) => ({ ...space, spaceCd: `9${String(i).padStart(4, "0")}` }));
    const junk = Array.from({ length: 11 }, () => JUNK_SPACE_ROW);
    mockGet.mockResolvedValue({ data: { items: [...valid, ...junk] } });

    // Act
    const spaces = await client.fetchSpaceList("hssc");

    // Assert
    expect(spaces).toHaveLength(30);
    const [fields] = mockLogger.warn.mock.calls[0]!;
    expect(fields).toMatchObject({ dropped: 11, total: 41 });
    expect(fields.invalid).toHaveLength(10);
    expect(fields.invalid[0]).toBe("#30: spaceCd");
  });

  it("rejects a spaceList body without items as the wrong shape", async () => {
    // Arrange
    mockGet.mockResolvedValue({ data: { count: 0 } });

    // Act & Assert
    await expect(client.fetchSpaceList("hssc")).rejects.toThrow(
      "campusMap.do spaceList (hssc) is not the expected shape: items",
    );
  });

  describe("buildInfo", () => {
    async function anniversaryHall(): Promise<ListedBuildingWithBuildNo> {
      mockGet.mockResolvedValueOnce({ data: BUILD_LIST });
      const [building] = await client.fetchBuildList("hssc");
      return building as ListedBuildingWithBuildNo;
    }

    it("rejects a response without floorItem as the wrong shape", async () => {
      // Arrange
      const building = await anniversaryHall();
      mockGet.mockResolvedValueOnce({ data: { attachItem: BUILD_INFO.attachItem } });

      // Act & Assert
      await expect(client.fetchBuildInfo(building)).rejects.toThrow(
        "campusMap.do buildInfo (buildNo 101) is not the expected shape: floorItem",
      );
    });

    it("leaves out a floor space without space_cd, keyed by its index", async () => {
      // Arrange
      const building = await anniversaryHall();
      const [first] = BUILD_INFO.floorItem;
      mockGet.mockResolvedValueOnce({
        data: { attachItem: BUILD_INFO.attachItem, floorItem: [...BUILD_INFO.floorItem, without(first, "space_cd")] },
      });

      // Act
      const { spaces } = await client.fetchBuildInfo(building);

      // Assert
      expect(spaces.map((s) => s.spaceCd)).toStrictEqual(["10101", "10102", "10106"]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        {
          event: "building.sync.payload_items_dropped",
          source: "buildInfo floorItem",
          scope: "buildNo 101",
          dropped: 1,
          total: 4,
          invalid: ["#3: space_cd"],
        },
        DROPPED,
      );
    });

    it("leaves out a photo without an id", async () => {
      // Arrange
      const building = await anniversaryHall();
      const [photo] = BUILD_INFO.attachItem;
      mockGet.mockResolvedValueOnce({ data: { attachItem: [photo, without(photo, "id")], floorItem: BUILD_INFO.floorItem } });

      // Act
      const { attachments } = await client.fetchBuildInfo(building);

      // Assert
      expect(attachments.map((a) => a.id)).toStrictEqual([12]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        {
          event: "building.sync.payload_items_dropped",
          source: "buildInfo attachItem",
          scope: "buildNo 101",
          dropped: 1,
          total: 2,
          invalid: ["#1: id"],
        },
        DROPPED,
      );
    });
  });
});
