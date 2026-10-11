/**
 * The shared building schemas. What it guards:
 *  - `campusFilter`: an absent or empty campus means no filter, and anything
 *    but hssc/nsc is rejected with the message the 400 shows;
 *  - `campusShapeDoc`: a shape document missing any field the overlay reads is
 *    rejected (the repository then leaves it out and logs it), a geometry the
 *    overlay cannot draw is rejected, unknown fields are dropped, and a skkuId
 *    is either null or a building id (a positive safe integer).
 * That every real document passes is checked where the importer writes them:
 * __tests__/nest/map/campus-shapes-import.test.ts.
 */
import { campusFilter, campusShapeDoc } from "./building.schema";

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
