/**
 * BuildingSyncClient against SKKU's campusMap.do as it answered on 2026-10-10
 * (captured, trimmed fixtures; see each file's `_about`). What it guards: the
 * request each mode sends, and the translation of SKKU's field names into the
 * raw building, attachment and space shapes, including the cases the real
 * payloads carry: a facility with an empty or missing buildNo, accessibility
 * flags other than "Y", and a space whose English name is missing.
 */
import fs from "fs";
import path from "path";

const mockGet = jest.fn();
jest.mock("axios", () => ({ get: mockGet }));

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
});

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

  it("lists nothing for a body without buildItems", async () => {
    // Arrange
    mockGet.mockResolvedValue({ data: {} });

    // Act & Assert
    await expect(client.fetchBuildList("nsc")).resolves.toEqual([]);
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
