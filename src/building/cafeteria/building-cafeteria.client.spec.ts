/**
 * BuildingCafeteriaClient against SKKU's campusMap.do sisulList as it answered
 * on 2026-10-17 (captured, trimmed fixtures; see each file's `_about`). What it
 * guards: the request, that every cafeteria (bizKind 0201) is found at either
 * nesting depth while the registry's other kinds are left out, the translation
 * of SKKU's field names (a missing spaceCd or coordinate is carried as null,
 * never made up), and the schema at the boundary: a cafeteria row that does
 * not match is left out and logged, and a response of the wrong shape rejects.
 */
import fs from "fs";
import path from "path";

const mockGet = jest.fn();
jest.mock("axios", () => ({ get: mockGet }));
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../infra/logger", () => mockLogger);

import { BuildingCafeteriaClient } from "./building-cafeteria.client";

const CAMPUS_MAP_URL = "https://www.skku.edu/skku/about/campusInfo/campusMap.do";
const fixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "../../../__tests__/nest/building/fixtures", name), "utf8"));
const SISUL_LIST_HSSC = fixture("campus-map-sisullist-hssc.json");
const SISUL_LIST_NSC = fixture("campus-map-sisullist-nsc.json");

const client = new BuildingCafeteriaClient();

beforeEach(() => {
  mockGet.mockReset();
  mockLogger.warn.mockReset();
});

/** The fixture with the cafeteria rows (the first category's first sub-list) replaced. */
function withCafeteriaRows(payload: { buildItems: Array<Record<string, unknown>> }, rows: unknown[]): unknown {
  const copy = JSON.parse(JSON.stringify(payload));
  copy.buildItems[0].subBizList[0].subList = rows;
  return copy;
}

describe("BuildingCafeteriaClient.fetchCafeterias", () => {
  it("asks for one campus's facility registry", async () => {
    // Arrange
    mockGet.mockResolvedValue({ data: SISUL_LIST_NSC });

    // Act
    await client.fetchCafeterias("nsc");

    // Assert
    expect(mockGet).toHaveBeenCalledWith(CAMPUS_MAP_URL, {
      params: { mode: "sisulList", campusCd: "2" },
      timeout: 30000,
    });
  });

  it("keeps every cafeteria of the campus and no other kind of facility", async () => {
    // Arrange
    mockGet.mockResolvedValueOnce({ data: SISUL_LIST_HSSC }).mockResolvedValueOnce({ data: SISUL_LIST_NSC });

    // Act
    const hssc = await client.fetchCafeterias("hssc");
    const nsc = await client.fetchCafeterias("nsc");

    // Assert
    expect(hssc.map((c) => c._id)).toEqual(["10201030", "10201031", "10201033", "10201034"]);
    expect(nsc.map((c) => c._id)).toEqual([
      "20201040",
      "20201104",
      "20201251",
      "20201252",
      "20201253",
      "20201254",
      "20201289",
    ]);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("finds a cafeteria row wherever the registry nests it", async () => {
    // Arrange
    const [faculty] = SISUL_LIST_HSSC.buildItems[0].subBizList[0].subList;
    const flat = { id: "500099", bizKind: "0201", subList: [{ ...faculty, conspaceCd: "10201099" }] };
    mockGet.mockResolvedValue({ data: { buildItems: [...SISUL_LIST_HSSC.buildItems, flat] } });

    // Act
    const cafeterias = await client.fetchCafeterias("hssc");

    // Assert
    expect(cafeterias.map((c) => c._id)).toContain("10201099");
  });

  it("translates a cafeteria row into the stored shape", async () => {
    // Arrange
    mockGet.mockResolvedValue({ data: SISUL_LIST_HSSC });

    // Act
    const [faculty] = await client.fetchCafeterias("hssc");

    // Assert
    expect(faculty).toEqual({
      _id: "10201030",
      kind: "cafeteria",
      campus: "hssc",
      name: { ko: "패컬티식당", en: "Faculty Dining Hall" },
      buildNo: "101",
      buildingName: { ko: "600주년기념관", en: "600th Anniversary Hall" },
      floor: { ko: "6층", en: "6F" },
      floorCode: "06",
      spaceCd: "10607A",
      location: { type: "Point", coordinates: [126.994501, 37.587584] },
    });
  });

  it("carries a missing spaceCd or coordinate as null", async () => {
    // Arrange
    mockGet.mockResolvedValue({ data: SISUL_LIST_NSC });

    // Act
    const cafeterias = await client.fetchCafeterias("nsc");

    // Assert
    const byId = new Map(cafeterias.map((c) => [c._id, c]));
    expect(byId.get("20201040")).toMatchObject({ spaceCd: null, buildNo: "204", floor: { ko: "3층", en: "3F" } });
    expect(byId.get("20201104")).toMatchObject({ spaceCd: null, buildNo: "203" });
    expect(byId.get("20201251")).toMatchObject({ spaceCd: "26B03", location: null });
  });

  it("carries a missing floor as null and a missing English name as empty", async () => {
    // Arrange
    const [faculty] = SISUL_LIST_HSSC.buildItems[0].subBizList[0].subList;
    const bare = { ...faculty };
    for (const key of ["floor", "floorNm", "floorNmEng", "bizNmEng", "buildNmEng"]) delete bare[key];
    mockGet.mockResolvedValue({ data: withCafeteriaRows(SISUL_LIST_HSSC, [bare]) });

    // Act
    const [cafeteria] = await client.fetchCafeterias("hssc");

    // Assert
    expect(cafeteria).toMatchObject({
      name: { ko: "패컬티식당", en: "" },
      buildingName: { ko: "600주년기념관", en: "" },
      floor: null,
      floorCode: null,
    });
  });

  it("leaves out and logs a cafeteria row without a buildNo or a name, keyed by its conspaceCd", async () => {
    // Arrange
    const [faculty, eunhaeng, geumjandi] = SISUL_LIST_HSSC.buildItems[0].subBizList[0].subList;
    const noBuildNo = { ...eunhaeng };
    delete noBuildNo.buildNo;
    mockGet.mockResolvedValue({ data: withCafeteriaRows(SISUL_LIST_HSSC, [faculty, noBuildNo, { ...geumjandi, bizNm: "" }]) });

    // Act
    const cafeterias = await client.fetchCafeterias("hssc");

    // Assert
    expect(cafeterias.map((c) => c._id)).toEqual(["10201030"]);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      {
        event: "building.cafeteria.payload_items_dropped",
        scope: "hssc",
        dropped: 2,
        total: 3,
        invalid: ["10201031: buildNo", "10201033: bizNm"],
      },
      "SKKU sisulList cafeterias left out: they do not match the schema",
    );
  });

  it("rejects a body without buildItems as the wrong shape", async () => {
    // Arrange
    mockGet.mockResolvedValue({ data: {} });

    // Act & Assert
    await expect(client.fetchCafeterias("nsc")).rejects.toThrow(
      "campusMap.do sisulList (nsc) is not the expected shape: buildItems",
    );
  });
});
