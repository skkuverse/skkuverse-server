/**
 * The schemas the cafeteria sync reads SKKU's sisulList through, checked
 * against the 2026-10-17 capture (the trimmed fixtures in
 * __tests__/nest/building/fixtures/, see each file's `_about`). What it guards:
 *  - every captured cafeteria row of both campuses passes, and so does the
 *    response;
 *  - which fields are required: a row missing a field outside its optional
 *    list fails at that field's path, the list read from the schema's shape,
 *    and one missing an optional field passes;
 *  - the values at each boundary: a conspaceCd is digits, a buildNo and a
 *    spaceCd are not empty, a coordinate is a number, as sisulList sends it.
 * How the client logs the rows a schema rejects is
 * building-cafeteria.client.spec.ts's.
 */
import fs from "fs";
import path from "path";
import { skkuSisulListCafeteria, skkuSisulListResponse } from "./building-cafeteria.schema";

type Payload = Record<string, unknown>;

const fixture = (name: string): { buildItems: Array<{ subBizList?: Array<{ bizKind: string; subList: Payload[] }> }> } =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "../../../__tests__/nest/building/fixtures", name), "utf8"));
const SISUL_LISTS = [fixture("campus-map-sisullist-hssc.json"), fixture("campus-map-sisullist-nsc.json")];
const CAFETERIA_ROWS = SISUL_LISTS.flatMap((list) => list.buildItems[0]!.subBizList!.find((s) => s.bizKind === "0201")!.subList);
const [FACULTY] = CAFETERIA_ROWS as [Payload];

const OPTIONAL_FIELDS = [
  "bizNmEng",
  "buildNm",
  "buildNmEng",
  "floor",
  "floorNm",
  "floorNmEng",
  "spaceCd",
  "latitude",
  "longtitude",
];

function without(payload: Payload, key: string): Payload {
  const copy = { ...payload };
  delete copy[key];
  return copy;
}

function issuePaths(payload: unknown): string[] {
  const result = skkuSisulListCafeteria.safeParse(payload);
  return [...new Set((result.error?.issues ?? []).map((issue) => issue.path.join(".")))];
}

describe("skkuSisulListResponse", () => {
  it("passes both captured responses and fails a body without buildItems", () => {
    // Act & Assert
    for (const list of SISUL_LISTS) expect(skkuSisulListResponse.safeParse(list).success).toBe(true);
    expect(skkuSisulListResponse.safeParse({ count: 0 }).success).toBe(false);
  });
});

describe("skkuSisulListCafeteria", () => {
  it("passes every captured cafeteria row, 11 across both campuses", () => {
    // Act
    const failing = CAFETERIA_ROWS.filter((row) => !skkuSisulListCafeteria.safeParse(row).success);

    // Assert
    expect(CAFETERIA_ROWS).toHaveLength(11);
    expect(failing).toEqual([]);
  });

  it.each(Object.keys(skkuSisulListCafeteria.shape))("a row without %s fails only when the field is required", (field) => {
    // Act
    const paths = issuePaths(without(FACULTY, field));

    // Assert
    expect(paths).toEqual(OPTIONAL_FIELDS.includes(field) ? [] : [field]);
  });

  it.each([
    ["a conspaceCd that is not digits", { conspaceCd: "1020103A" }, "conspaceCd"],
    ["an empty buildNo", { buildNo: "" }, "buildNo"],
    ["an empty spaceCd", { spaceCd: "" }, "spaceCd"],
    ["an empty name", { bizNm: "" }, "bizNm"],
    ["a coordinate sent as a string", { latitude: "37.587584" }, "latitude"],
  ])("fails %s", (_case, override, field) => {
    // Act & Assert
    expect(issuePaths({ ...FACULTY, ...override })).toEqual([field]);
  });
});
