/**
 * The schemas the building sync reads SKKU's campusMap.do through, checked
 * against the 2026-10-10 capture (the trimmed fixtures in
 * __tests__/nest/building/fixtures/, see each file's `_about`). What it guards:
 *  - every captured response and item passes, and parsing drops the fields
 *    the sync does not read while passing the rest through unchanged;
 *  - which fields are required: an item or response missing any field outside
 *    its optional list fails at that field's path, the list read from the
 *    schema's shape, and one missing an optional field passes;
 *  - the values at each boundary: an id is a building id (a positive safe
 *    integer), a buildList buildNo may be "" or null (a facility) while a
 *    spaceList one may not, a coordinate is a string that parses to a finite
 *    number, a space code and a building name are not empty.
 * How the client logs and counts the items a schema rejects is
 * building-sync.client.spec.ts's.
 */
import fs from "fs";
import path from "path";
import type { z } from "zod";
import {
  skkuBuildInfoAttachment,
  skkuBuildInfoFloor,
  skkuBuildInfoResponse,
  skkuBuildListItem,
  skkuBuildListResponse,
  skkuSpaceListItem,
  skkuSpaceListResponse,
} from "./building-sync.schema";

type Payload = Record<string, unknown>;

const fixture = (name: string): Payload =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "../../../__tests__/nest/building/fixtures", name), "utf8"));
const BUILD_LIST = fixture("campus-map-buildlist-hssc.json");
const BUILD_INFO = fixture("campus-map-buildinfo-101.json");
const SPACE_LIST = fixture("campus-map-spacelist-hssc.json");

const itemsOf = (payload: Payload, key: string): Payload[] => payload[key] as Payload[];
const [ANNIVERSARY_HALL] = itemsOf(BUILD_LIST, "buildItems") as [Payload];
const [PHOTO] = itemsOf(BUILD_INFO, "attachItem") as [Payload];
const [FLOOR_SPACE] = itemsOf(BUILD_INFO, "floorItem") as [Payload];
const [SPACE] = itemsOf(SPACE_LIST, "items") as [Payload];

function without(payload: Payload, key: string): Payload {
  const copy = { ...payload };
  delete copy[key];
  return copy;
}

function pick(payload: Payload, keys: readonly string[]): Payload {
  return Object.fromEntries(Object.entries(payload).filter(([key]) => keys.includes(key)));
}

function issuePaths(schema: z.ZodType, payload: unknown): string[] {
  const result = schema.safeParse(payload);
  return [...new Set((result.error?.issues ?? []).map((issue) => issue.path.join(".")))];
}

interface ShapeCase {
  name: string;
  schema: z.ZodObject;
  captured: Payload[];
  optional: string[];
}

const RESPONSES: ShapeCase[] = [
  { name: "skkuBuildListResponse", schema: skkuBuildListResponse, captured: [BUILD_LIST], optional: [] },
  { name: "skkuBuildInfoResponse", schema: skkuBuildInfoResponse, captured: [BUILD_INFO], optional: [] },
  { name: "skkuSpaceListResponse", schema: skkuSpaceListResponse, captured: [SPACE_LIST], optional: [] },
];

const ITEMS: ShapeCase[] = [
  {
    name: "skkuBuildListItem",
    schema: skkuBuildListItem,
    captured: itemsOf(BUILD_LIST, "buildItems"),
    optional: [
      "buildNo",
      "buildNmEng",
      "krText",
      "enText",
      "filePath",
      "encodeNm",
      "handicappedElevatorYn",
      "handicappedToiletYn",
      "createDt",
      "updateDt",
    ],
  },
  {
    name: "skkuBuildInfoAttachment",
    schema: skkuBuildInfoAttachment,
    captured: itemsOf(BUILD_INFO, "attachItem"),
    optional: ["file_path", "encode_nm", "file_nm", "image_alt"],
  },
  {
    name: "skkuBuildInfoFloor",
    schema: skkuBuildInfoFloor,
    captured: itemsOf(BUILD_INFO, "floorItem"),
    optional: ["floor_nm_eng", "spcae_nm", "spcae_nm_eng"],
  },
  {
    name: "skkuSpaceListItem",
    schema: skkuSpaceListItem,
    captured: itemsOf(SPACE_LIST, "items"),
    optional: ["floorNmEng", "spcaeNm", "spcaeNmEng", "buildNm", "buildNmEng", "conspaceCd"],
  },
];

describe.each([...RESPONSES, ...ITEMS])("$name", ({ schema, captured, optional }) => {
  const fields = Object.keys(schema.shape);
  const required = fields.filter((field) => !optional.includes(field));
  const [full] = captured as [Payload];

  it("reads only fields the first captured payload carries, so the lists below cover the schema", () => {
    // Act & Assert
    expect(fields.filter((field) => !(field in full))).toEqual([]);
    expect(optional.filter((field) => !fields.includes(field))).toEqual([]);
  });

  it("passes every captured payload, keeping the fields it reads and dropping the rest", () => {
    // Act
    const parsed = captured.map((payload) => schema.safeParse(payload));

    // Assert
    expect(parsed.map((result) => result.error?.issues)).toEqual(captured.map(() => undefined));
    expect(parsed.map((result) => result.data)).toStrictEqual(captured.map((payload) => pick(payload, fields)));
  });

  it.each(required)("rejects a payload without %s, at that path", (field) => {
    // Act & Assert
    expect(issuePaths(schema, without(full, field))).toEqual([field]);
  });

  it("passes a payload without any one of its optional fields", () => {
    // Act
    const rejected = optional.filter((field) => !schema.safeParse(without(full, field)).success);

    // Assert
    expect(rejected).toEqual([]);
  });
});

describe.each([
  ["skkuBuildListResponse", skkuBuildListResponse, "buildItems"],
  ["skkuBuildInfoResponse", skkuBuildInfoResponse, "attachItem"],
  ["skkuBuildInfoResponse", skkuBuildInfoResponse, "floorItem"],
  ["skkuSpaceListResponse", skkuSpaceListResponse, "items"],
])("%s's %s", (_name, schema, list) => {
  it.each([
    ["an object", { 0: {} }],
    ["null", null],
    ["a string", "[]"],
  ])("rejects %s for the list", (_case, value) => {
    // Arrange
    const response = { buildItems: [], attachItem: [], floorItem: [], items: [], [list]: value };

    // Act & Assert
    expect(issuePaths(schema, response)).toEqual([list]);
  });

  it("passes a list whatever its items hold, leaving them to the item schemas", () => {
    // Arrange
    const junk = [null, 1, "x"];

    // Act
    const result = schema.safeParse({ buildItems: junk, attachItem: junk, floorItem: junk, items: junk });

    // Assert
    expect(result.success).toBe(true);
    expect((result.data as Payload)[list]).toEqual(junk);
  });
});

describe("skkuBuildListItem's values", () => {
  it.each([1, 88])("accepts id %p", (id) => {
    // Act & Assert
    expect(skkuBuildListItem.safeParse({ ...ANNIVERSARY_HALL, id }).success).toBe(true);
  });

  it.each([0, -1, 2.5, "2", Number.MAX_SAFE_INTEGER + 1])("rejects id %p, at the path id", (id) => {
    // Act & Assert
    expect(issuePaths(skkuBuildListItem, { ...ANNIVERSARY_HALL, id })).toEqual(["id"]);
  });

  it.each(["101", "", null])("accepts buildNo %p, kept as sent", (buildNo) => {
    // Act
    const result = skkuBuildListItem.safeParse({ ...ANNIVERSARY_HALL, buildNo });

    // Assert
    expect(result.success).toBe(true);
    expect(result.data?.buildNo).toBe(buildNo);
  });

  it("rejects a numeric buildNo, at the path buildNo", () => {
    // Act & Assert
    expect(issuePaths(skkuBuildListItem, { ...ANNIVERSARY_HALL, buildNo: 101 })).toEqual(["buildNo"]);
  });

  it("rejects an empty building name, at the path buildNm", () => {
    // Act & Assert
    expect(issuePaths(skkuBuildListItem, { ...ANNIVERSARY_HALL, buildNm: "" })).toEqual(["buildNm"]);
  });

  it.each(["latitude", "longtitude"])("accepts a %s string that parses to a finite number", (field) => {
    // Act & Assert
    expect(skkuBuildListItem.safeParse({ ...ANNIVERSARY_HALL, [field]: "-0.5" }).success).toBe(true);
  });

  it.each([
    ["latitude", "abc"],
    ["latitude", ""],
    ["latitude", "Infinity"],
    ["latitude", 37.587361],
    ["longtitude", "abc"],
    ["longtitude", "-Infinity"],
    ["longtitude", 126.994479],
  ])("rejects %s %p, at that path", (field, value) => {
    // Act & Assert
    expect(issuePaths(skkuBuildListItem, { ...ANNIVERSARY_HALL, [field]: value })).toEqual([field]);
  });
});

describe("the buildInfo items' values", () => {
  it.each([12.5, "12"])("rejects attachment id %p, at the path id", (id) => {
    // Act & Assert
    expect(issuePaths(skkuBuildInfoAttachment, { ...PHOTO, id })).toEqual(["id"]);
  });

  it.each([
    ["an empty space_cd", "space_cd", ""],
    ["a numeric space_cd", "space_cd", 10101],
    ["a numeric floor_nm", "floor_nm", 1],
  ])("rejects a floor space with %s, at that path", (_case, field, value) => {
    // Act & Assert
    expect(issuePaths(skkuBuildInfoFloor, { ...FLOOR_SPACE, [field]: value })).toEqual([field]);
  });
});

describe("skkuSpaceListItem's values", () => {
  it.each([
    ["an empty spaceCd", "spaceCd"],
    ["an empty buildNo, which a buildList item may send", "buildNo"],
  ])("rejects %s, at that path", (_case, field) => {
    // Act & Assert
    expect(issuePaths(skkuSpaceListItem, { ...SPACE, [field]: "" })).toEqual([field]);
  });

  it("accepts a null conspaceCd", () => {
    // Act
    const result = skkuSpaceListItem.safeParse({ ...SPACE, conspaceCd: null });

    // Assert
    expect(result.success).toBe(true);
    expect(result.data?.conspaceCd).toBeNull();
  });
});
