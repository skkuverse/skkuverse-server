/**
 * How the produced contracts are computed from `.wire` modules
 * (`__tests__/helpers/contracts/artifacts.ts`): which exports become ids, the
 * id shape, the exact bytes of a schema artifact and of `index.json`, and the
 * routes each id lists. The drift check and the export script compare and
 * write exactly these bytes, so a change here shows as a diff in
 * `contracts/produced/`.
 */
import { z } from "zod";
import { routeWireRefs } from "../helpers/architecture/wire-routes";
import {
  contractIndex,
  producedFiles,
  schemaArtifact,
  wireSchemas,
  type WireModule,
} from "../helpers/contracts/artifacts";

const moduleOf = (file: string, exports: Record<string, unknown>, source = ""): WireModule => ({ file, source, exports });

describe("wire schemas", () => {
  it("are the zod exports of each module, modules in path order and exports by name", () => {
    // Arrange
    const modules = [
      moduleOf("src/b/b.wire.ts", { zeta: z.string(), alpha: z.number(), B_KINDS: ["a"], toB: () => 1 }),
      moduleOf("src/a/a.wire.ts", { one: z.boolean() }),
    ];

    // Act
    const schemas = wireSchemas(modules);

    // Assert
    expect(schemas.map((s) => [s.id, s.source, s.exportName])).toEqual([
      ["a.one", "src/a/a.wire.ts", "one"],
      ["b.alpha", "src/b/b.wire.ts", "alpha"],
      ["b.zeta", "src/b/b.wire.ts", "zeta"],
    ]);
  });

  it("fail on an id two files would both produce", () => {
    // Arrange
    const modules = [
      moduleOf("src/b/x.wire.ts", { item: z.string() }),
      moduleOf("src/a/x.wire.ts", { item: z.string() }),
    ];

    // Act & Assert
    expect(() => wireSchemas(modules)).toThrow("id x.item comes from both src/a/x.wire.ts and src/b/x.wire.ts");
  });
});

describe("a schema artifact", () => {
  it("is the input-mode draft-07 export, two-space indented, with a trailing newline", () => {
    // Arrange
    const schema = z.object({ name: z.string(), tags: z.array(z.string()).optional() });

    // Act
    const artifact = schemaArtifact(schema);

    // Assert
    expect(artifact).toBe(
      [
        "{",
        '  "$schema": "http://json-schema.org/draft-07/schema#",',
        '  "type": "object",',
        '  "properties": {',
        '    "name": {',
        '      "type": "string"',
        "    },",
        '    "tags": {',
        '      "type": "array",',
        '      "items": {',
        '        "type": "string"',
        "      }",
        "    }",
        "  },",
        '  "required": [',
        '    "name"',
        "  ]",
        "}",
        "",
      ].join("\n"),
    );
  });
});

describe("the produced files", () => {
  it("are an index.json of exactly {}\\n when there is no wire schema", () => {
    // Act
    const files = producedFiles([], []);

    // Assert
    expect([...files]).toEqual([["index.json", "{}\n"]]);
  });

  const listWire = moduleOf(
    "src/x/list/x-list.wire.ts",
    { xList: z.array(z.string()), xUnused: z.string() },
    [
      'import { z } from "zod";',
      "export const xList = z.array(z.string());",
      "export type XList = z.input<typeof xList>;",
      "export const xUnused = z.string();",
    ].join("\n"),
  );
  const searchWire = moduleOf(
    "src/x/search/x-search.wire.ts",
    { xSearchData: z.object({ hits: z.array(z.string()) }), xSearchMeta: z.object({ hitCount: z.number() }) },
    [
      'import { z } from "zod";',
      "export const xSearchData = z.object({ hits: z.array(z.string()) });",
      "export type XSearchData = z.input<typeof xSearchData>;",
      "export const xSearchMeta = z.object({ hitCount: z.number() });",
      "export type XSearchMeta = z.input<typeof xSearchMeta>;",
    ].join("\n"),
  );
  const controller = [
    'import type { XList as List } from "./x-list.wire";',
    'import type * as XWire from "./x-list.wire";',
    'import type { XSearchData, XSearchMeta } from "../search/x-search.wire";',
    'import type { XOther } from "./x-list.types";',
    '@Controller("x")',
    "export class XListController {",
    '  @Get("list") list(): Promise<List> {}',
    '  @Get("all") all(): XWire.XList {}',
    '  @Get("typed") typed(): z.input<typeof XWire.xList> {}',
    '  @Get("search") search(): Promise<WithMeta<XSearchData, XSearchMeta>> {}',
    '  @Get("other") other(): Promise<XOther> {}',
    "}",
    '@Controller("internal/x")',
    "export class XListInternalController {",
    '  @Get("list") list(): Promise<List> {}',
    "}",
  ].join("\n");

  it("index each id with its source, export and the sorted routes that reference it by schema or z.input alias", () => {
    // Arrange
    const schemas = wireSchemas([searchWire, listWire]);
    const routes = routeWireRefs("src/x/list/x-list.controller.ts", controller);

    // Act
    const index = contractIndex(schemas, routes);

    // Assert
    expect(index).toEqual({
      "x-list.xList": {
        source: "src/x/list/x-list.wire.ts",
        export: "xList",
        routes: ["GET internal/x/list", "GET x/all", "GET x/list", "GET x/typed"],
      },
      "x-list.xUnused": { source: "src/x/list/x-list.wire.ts", export: "xUnused", routes: [] },
      "x-search.xSearchData": { source: "src/x/search/x-search.wire.ts", export: "xSearchData", routes: ["GET x/search"] },
      "x-search.xSearchMeta": { source: "src/x/search/x-search.wire.ts", export: "xSearchMeta", routes: ["GET x/search"] },
    });
  });

  it("hold index.json, keys sorted, and one schema file per id", () => {
    // Arrange
    const schemas = wireSchemas([searchWire, listWire]);
    const routes = routeWireRefs("src/x/list/x-list.controller.ts", controller);

    // Act
    const files = producedFiles(schemas, routes);

    // Assert
    expect([...files.keys()]).toEqual([
      "index.json",
      "x-list.xList.schema.json",
      "x-list.xUnused.schema.json",
      "x-search.xSearchData.schema.json",
      "x-search.xSearchMeta.schema.json",
    ]);
    expect(Object.keys(JSON.parse(files.get("index.json")!) as object)).toEqual([
      "x-list.xList",
      "x-list.xUnused",
      "x-search.xSearchData",
      "x-search.xSearchMeta",
    ]);
    expect(files.get("x-search.xSearchMeta.schema.json")).toBe(schemaArtifact(z.object({ hitCount: z.number() })));
  });
});
