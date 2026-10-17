/**
 * toCafeteriaList: each cafeteria joined to its stored building by buildNo,
 * in the order given. What it guards: the conspaceCd is the id, the building
 * is the one with the same buildNo (or null when none is stored), an empty
 * English name or floor shows the Korean one without touching the inputs, and
 * a missing floor, room or location stays null.
 */
import type { BuildingDoc } from "../../building/building.document";
import type { ListedCafeteria } from "../../building/cafeteria-list/building-cafeteria-list.document";
import type { BuildNo, DisplayNo, SkkuId, SpaceCd } from "../../building/building.types";
import { toCafeteriaList } from "./meals-catalog.mapper";

const ANNIVERSARY_HALL = {
  _id: 2 as SkkuId,
  buildNo: "101" as BuildNo,
  displayNo: "1" as DisplayNo,
  campus: "hssc",
  name: { ko: "600주년기념관", en: "600th Anniversary Hall" },
} as BuildingDoc;
const LAW_SCHOOL = {
  _id: 3 as SkkuId,
  buildNo: "102" as BuildNo,
  displayNo: "2" as DisplayNo,
  campus: "hssc",
  name: { ko: "법학관", en: "" },
} as BuildingDoc;

const FACULTY: ListedCafeteria = {
  _id: "10201030",
  campus: "hssc",
  name: { ko: "패컬티식당", en: "Faculty Dining Hall" },
  buildNo: "101" as BuildNo,
  floor: { ko: "6층", en: "6F" },
  spaceCd: "10607A" as SpaceCd,
  location: { type: "Point", coordinates: [126.994501, 37.587584] },
};

describe("toCafeteriaList", () => {
  it("serves a cafeteria by its conspaceCd, with the building that has its buildNo", () => {
    // Act
    const list = toCafeteriaList([FACULTY], [LAW_SCHOOL, ANNIVERSARY_HALL]);

    // Assert
    expect(list).toEqual({
      cafeterias: [
        {
          id: "10201030",
          campus: "hssc",
          name: { ko: "패컬티식당", en: "Faculty Dining Hall" },
          building: { skkuId: 2, buildNo: "101", displayNo: "1", name: { ko: "600주년기념관", en: "600th Anniversary Hall" } },
          floor: { ko: "6층", en: "6F" },
          spaceCd: "10607A",
          location: { type: "Point", coordinates: [126.994501, 37.587584] },
        },
      ],
    });
  });

  it("fills an empty English name and floor from Korean, leaving the inputs as they were", () => {
    // Arrange
    const beopgoeul: ListedCafeteria = {
      ...FACULTY,
      _id: "10201034",
      name: { ko: "법고을식당", en: "" },
      buildNo: "102" as BuildNo,
      floor: { ko: "지하2층", en: "" },
    };

    // Act
    const [served] = toCafeteriaList([beopgoeul], [LAW_SCHOOL]).cafeterias;

    // Assert
    expect(served!.name).toEqual({ ko: "법고을식당", en: "법고을식당" });
    expect(served!.floor).toEqual({ ko: "지하2층", en: "지하2층" });
    expect(served!.building!.name).toEqual({ ko: "법학관", en: "법학관" });
    expect(beopgoeul.name).toEqual({ ko: "법고을식당", en: "" });
    expect(LAW_SCHOOL.name).toEqual({ ko: "법학관", en: "" });
  });

  it("keeps a missing floor, room and location null, and a building no stored one matches null", () => {
    // Arrange
    const gusijae: ListedCafeteria = {
      _id: "20201040",
      campus: "nsc",
      name: { ko: "구시재식당", en: "Faculty Cafeteria(Gusijae)" },
      buildNo: "204" as BuildNo,
      floor: null,
      spaceCd: null,
      location: null,
    };

    // Act
    const [served] = toCafeteriaList([gusijae], [ANNIVERSARY_HALL]).cafeterias;

    // Assert
    expect(served).toEqual({
      id: "20201040",
      campus: "nsc",
      name: { ko: "구시재식당", en: "Faculty Cafeteria(Gusijae)" },
      building: null,
      floor: null,
      spaceCd: null,
      location: null,
    });
  });

  it("keeps the order it is given", () => {
    // Arrange
    const eunhaenggol: ListedCafeteria = { ...FACULTY, _id: "10201031", name: { ko: "은행골식당", en: "Eunhaenggol" } };

    // Act
    const list = toCafeteriaList([eunhaenggol, FACULTY], [ANNIVERSARY_HALL]);

    // Assert
    expect(list.cafeterias.map((c) => c.id)).toEqual(["10201031", "10201030"]);
  });
});
