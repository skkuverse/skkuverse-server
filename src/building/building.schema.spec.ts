/**
 * The shared building schemas. What it guards:
 *  - `campusFilter`: an absent or empty campus means no filter, and anything
 *    but hssc/nsc is rejected with the message the 400 shows;
 *  - `campusShapeDoc`: a shape document missing any field the overlay reads is
 *    rejected (the repository then leaves it out and logs it), a geometry the
 *    overlay cannot draw is rejected, unknown fields are dropped, and a skkuId
 *    is either null or a building id (a positive safe integer).
 *  - `cafeteriaDoc`: every cafeteria skkuverse-crawler wrote to skkumap_dev
 *    passes with the fields it reads, a missing spaceCd or location as null;
 *    a row missing any field the readers use, of another kind, or with an
 *    empty buildNo or spaceCd is rejected (the readers then leave it out).
 *  - `buildingDoc` and `storedSpace`: the buildings and spaces captured from
 *    skkumap_dev pass with the fields the readers use, the writer's
 *    bookkeeping dropped and `displayNo` derived from `buildNo`; a document
 *    missing a required field, or with an id or code the brands reject, fails.
 * That every real campus shape passes is checked where the importer writes
 * them: __tests__/nest/map/campus-shapes-import.test.ts.
 */
import { capturedSkkumap } from "../../__tests__/helpers/building/buildings";
import { storedFacilities } from "../../__tests__/helpers/building/facilities";
import { buildingDoc, cafeteriaDoc, campusFilter, campusShapeDoc, storedBuilding, storedSpace } from "./building.schema";

const RING = [
  [126.9944, 37.5873],
  [126.9954, 37.5873],
  [126.9954, 37.5883],
  [126.9944, 37.5883],
  [126.9944, 37.5873],
];

const SHAPE = {
  _id: "bldg-2-footprint",
  campus: "hssc",
  layerId: "building_labels",
  geometry: { type: "Polygon", coordinates: [RING] },
  title: { ko: "수선관 외곽", en: "Suseon Hall outline" },
  subtitle: null,
  skkuId: 2,
  order: 0,
};

/** The fields a shape may leave out. Every other field of the schema is required. */
const OPTIONAL_FIELDS = new Set(["subtitle"]);

describe("campusFilter", () => {
  it.each([
    [undefined, undefined],
    ["", undefined],
    ["hssc", "hssc"],
    ["nsc", "nsc"],
  ])("reads %j as %j", (raw, campus) => {
    // Act & Assert
    expect(campusFilter.parse(raw)).toBe(campus);
  });

  it.each(["mars", "HSSC", ["hssc", "nsc"]])("rejects %j with the campus message", (raw) => {
    // Act
    const result = campusFilter.safeParse(raw);

    // Assert
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("campus must be 'hssc' or 'nsc'");
  });
});

describe("campusShapeDoc", () => {
  it("accepts a complete shape and drops fields it does not read", () => {
    // Act
    const result = campusShapeDoc.safeParse({ ...SHAPE, importedAt: "2026-09-01", note: "x" });

    // Assert
    expect(result.success).toBe(true);
    expect(result.data).toEqual(SHAPE);
  });

  it("accepts a shape with no subtitle, or no building behind it", () => {
    // Arrange
    const withoutSubtitle: Record<string, unknown> = { ...SHAPE };
    delete withoutSubtitle.subtitle;

    // Act & Assert
    expect(campusShapeDoc.safeParse(withoutSubtitle).success).toBe(true);
    expect(campusShapeDoc.safeParse({ ...SHAPE, skkuId: null }).success).toBe(true);
  });

  const requiredFields = Object.keys(campusShapeDoc.shape).filter((field) => !OPTIONAL_FIELDS.has(field));

  it("checks every field of SHAPE, so the required list below is complete", () => {
    // Act & Assert
    expect(Object.keys(campusShapeDoc.shape).sort()).toEqual(Object.keys(SHAPE).sort());
  });

  it.each(requiredFields)("rejects a shape without %s", (field) => {
    // Arrange
    const shape: Record<string, unknown> = { ...SHAPE };
    delete shape[field];

    // Act & Assert
    expect(campusShapeDoc.safeParse(shape).success).toBe(false);
  });

  it.each([
    ["a campus outside hssc/nsc", { campus: "mars" }],
    ["a title without English", { title: { ko: "수선관" } }],
    ["a fractional skkuId", { skkuId: 2.5 }],
    ["a ring of three points, which bounds no area", { geometry: { type: "Polygon", coordinates: [RING.slice(0, 3)] } }],
    ["a geometry type the overlay does not draw", { geometry: { type: "MultiPolygon", coordinates: [[RING]] } }],
  ])("rejects %s", (_case, override) => {
    // Act & Assert
    expect(campusShapeDoc.safeParse({ ...SHAPE, ...override }).success).toBe(false);
  });
});

describe("campusShapeDoc reads skkuId as a building id", () => {
  it.each([0, -1, Number.MAX_SAFE_INTEGER + 1])("rejects skkuId %p at the path skkuId", (skkuId) => {
    // Act
    const result = campusShapeDoc.safeParse({ ...SHAPE, skkuId });

    // Assert
    expect(result.success).toBe(false);
    // The repository logs a dropped shape by its issue paths, so the log names the field.
    expect([...new Set(result.error?.issues.map((issue) => issue.path.join(".")))]).toEqual(["skkuId"]);
  });

  it.each([1, null])("accepts skkuId %p", (skkuId) => {
    // Act
    const result = campusShapeDoc.safeParse({ ...SHAPE, skkuId });

    // Assert
    expect(result.success).toBe(true);
    expect(result.data?.skkuId).toBe(skkuId);
  });
});

describe("cafeteriaDoc", () => {
  it("accepts every cafeteria the crawler wrote, keeping only the fields the readers use", () => {
    // Arrange
    const { cafeterias } = storedFacilities();

    // Act
    const parsed = cafeterias.map((doc) => cafeteriaDoc.parse(doc));

    // Assert
    expect(parsed[0]).toEqual({
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
    expect(parsed[1]?.spaceCd).toBeNull();
    expect(parsed[2]?.location).toBeNull();
  });

  it.each(Object.keys(cafeteriaDoc.shape))("rejects a cafeteria without %s", (field) => {
    // Arrange
    const [cafeteria] = storedFacilities().cafeterias;
    delete cafeteria![field];

    // Act & Assert
    expect(cafeteriaDoc.safeParse(cafeteria).success).toBe(false);
  });

  it.each([
    ["a facility of another kind", { kind: "facility" }],
    ["an empty buildNo", { buildNo: "" }],
    ["an empty spaceCd", { spaceCd: "" }],
    ["a campus outside hssc/nsc", { campus: "mars" }],
    ["a location without coordinates", { location: { type: "Point" } }],
  ])("rejects %s", (_case, override) => {
    // Arrange
    const [cafeteria] = storedFacilities().cafeterias;

    // Act & Assert
    expect(cafeteriaDoc.safeParse({ ...cafeteria, ...override }).success).toBe(false);
  });

  it("rejects the registry's other facilities", () => {
    // Act & Assert
    expect(cafeteriaDoc.safeParse(storedFacilities().facility).success).toBe(false);
  });
});

describe("buildingDoc", () => {
  it("accepts every captured building, dropping the writer's bookkeeping and deriving displayNo", () => {
    // Arrange
    const [anniversaryHall, pavilion] = capturedSkkumap().buildings;

    // Act
    const hall = buildingDoc.parse(anniversaryHall);
    const facility = buildingDoc.parse(pavilion);

    // Assert
    expect(hall).toMatchObject({ _id: 2, buildNo: "101", displayNo: "1", type: "building", updatedAt: new Date("2026-03-16T10:14:08.185Z") });
    expect(hall.accessibility.detail?.sections[0]?.elevatorStatus).toBe("arrival");
    expect(hall).not.toHaveProperty("sync");
    expect(hall).not.toHaveProperty("enrichVersion");
    expect(hall).not.toHaveProperty("extensions");
    expect(facility).toMatchObject({ _id: 69, buildNo: null, displayNo: null, type: "facility", attachments: [] });
  });

  const optionalFields = new Set(["attachments", "updatedAt"]);
  it.each(Object.keys(storedBuilding.shape).filter((field) => !optionalFields.has(field)))("rejects a building without %s", (field) => {
    // Arrange
    const [building] = capturedSkkumap().buildings;
    delete building![field];

    // Act & Assert
    expect(buildingDoc.safeParse(building).success).toBe(false);
  });

  it.each([
    ["an id that is no building id", { _id: 0 }],
    ["an empty buildNo", { buildNo: "" }],
    ["a type outside building/facility", { type: "gate" }],
    ["a location without coordinates", { location: { type: "Point" } }],
  ])("rejects %s", (_case, override) => {
    // Arrange
    const [building] = capturedSkkumap().buildings;

    // Act & Assert
    expect(buildingDoc.safeParse({ ...building, ...override }).success).toBe(false);
  });
});

describe("storedSpace", () => {
  it("accepts every captured space with the fields the readers use", () => {
    // Arrange
    const { spaces } = capturedSkkumap();

    // Act
    const parsed = spaces.map((space) => storedSpace.parse(space));

    // Assert
    expect(parsed[0]).toEqual({
      spaceCd: "10115",
      buildNo: "101",
      campus: "hssc",
      floor: { ko: "1층", en: "1F" },
      name: { ko: "예비군연대", en: "Reserved Forces Regiment" },
      buildingName: { ko: "600주년기념관", en: "600th Anniversary Hall" },
      conspaceCd: "10101015",
    });
  });

  it.each(Object.keys(storedSpace.shape).filter((field) => field !== "buildingName"))("rejects a space without %s", (field) => {
    // Arrange
    const [space] = capturedSkkumap().spaces;
    delete space![field];

    // Act & Assert
    expect(storedSpace.safeParse(space).success).toBe(false);
  });

  it("accepts a space with a null spaceCd, which two skkumap_dev spaces carry", () => {
    // Arrange
    const [space] = capturedSkkumap().spaces;

    // Act & Assert
    expect(storedSpace.safeParse({ ...space, spaceCd: null }).success).toBe(true);
  });
});
