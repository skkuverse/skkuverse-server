/**
 * listedCafeteria: the fields a cafeteria listing serves, parsed from what
 * skkuverse-crawler wrote. What it guards: every captured cafeteria passes and
 * comes out with exactly the listed fields (no floorCode, buildingName or
 * crawler-only field), and a cafeteria missing any of them is rejected, so
 * the list repository leaves it out.
 */
import { storedFacilities } from "../../../__tests__/helpers/building/facilities";
import { listedCafeteria } from "./building-cafeteria-list.schema";

const LISTED_FIELDS = ["_id", "buildNo", "campus", "floor", "location", "name", "spaceCd"];

describe("listedCafeteria", () => {
  it("reads every captured cafeteria as the fields a listing serves", () => {
    // Arrange
    const { cafeterias } = storedFacilities();

    // Act
    const listed = cafeterias.map((doc) => listedCafeteria.parse(doc));

    // Assert
    expect(listed[1]).toEqual({
      _id: "20201040",
      campus: "nsc",
      name: { ko: "구시재식당", en: "Faculty Cafeteria(Gusijae)" },
      buildNo: "204",
      floor: { ko: "3층", en: "3F" },
      spaceCd: null,
      location: { type: "Point", coordinates: [126.972533, 37.29396] },
    });
    expect(listed.map((c) => Object.keys(c).sort())).toEqual([LISTED_FIELDS, LISTED_FIELDS, LISTED_FIELDS]);
  });

  it.each(Object.keys(listedCafeteria.shape))("rejects a cafeteria without %s", (field) => {
    // Arrange
    const [cafeteria] = storedFacilities().cafeterias;
    delete cafeteria![field];

    // Act & Assert
    expect(listedCafeteria.safeParse(cafeteria).success).toBe(false);
  });
});
