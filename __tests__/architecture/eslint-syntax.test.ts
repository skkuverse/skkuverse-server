/**
 * The syntax rules that run beside the role blocks (eslint.config.js), each an
 * alias of no-restricted-syntax under the local `src-syntax` plugin so a
 * block that sets one leaves the rest alone:
 *
 *   - `zod/issue-path`: every issue src/ hands zod names its `path`
 *     (`path: []` when the issue is the whole value), since parseConfigFile
 *     and the boot error print it: `ctx.addIssue({ … })`, `ctx["addIssue"]`,
 *     a destructured `addIssue({ … })` and `ctx.issues.push({ … })`; a bare
 *     message string and `path: undefined` are refused too, and so is an
 *     object-level `.refine` (on `z.object`, `strictObject`, `looseObject`
 *     or `.extend`, or after refinements of one) without a `path`. Specs may
 *     build a pathless issue to test how one is answered.
 *   - `schemas/no-double-cast`: no cast through `unknown` (or any second
 *     cast) in a `.schema`, which would certify fields the schema never
 *     checked.
 *   - `boundaries/pure-schema`: a `.rules` or `.mapper` imports a `.schema`
 *     for types only, so boundaries/pure cannot be passed one hop deep.
 *   - `boundaries/literals`: a hex color (`#FFFFFF`, `#FF003626`, a bare
 *     hex that mixes letters and digits, or any bare hex bound to a name
 *     ending in `color`), an `rgb()` string, a `0x…` color number or a web
 *     view path (`/skku/…`, `${origin}/skku/…`) appears only in a
 *     `*.constants.ts` file (or JSON). Specs state the values they expect
 *     and are left out.
 *   - `readability/src`: no comma operator in src/, parenthesised or not
 *     (`return (dropped.push(reason), null)` packs two steps into one).
 *   - `naming/generic-names`: in every module scope's sources, no name that
 *     says nothing on its own (`info`, `obj`, `tmp`, `helper`, `manager`).
 *   - `specs/fixed-clock`: a spec in a module scope (and a top-level
 *     module's `__tests__/nest/<module>/` tests) never constructs the real
 *     `Clock`, aliased, through a namespace, as a Nest provider or as a
 *     subclass; an alias whose name hides the real Clock (`Tick`,
 *     `FixedClock`) is refused at its import. It passes a fixed fake, so one
 *     answer reads one instant and does not depend on the day the test runs.
 *   - `migrated/syntax-clock`: the `Date.now()` / `new Date()` ban covers
 *     every module scope but the shared layers, derived from the tree
 *     (scopes.ts), so a new module is bound from its first file. It and the
 *     pure files' ban also refuse moment reading the clock: `moment()`,
 *     `moment.utc()` and `moment.now()` without an argument, and
 *     `moment.tz(zone)`.
 */
import { Linter } from "eslint";
import { SHARED_LAYERS } from "../helpers/architecture/ast";
import { moduleScopes } from "../helpers/architecture/scopes";

const tsparser = require("@typescript-eslint/parser");
const config: Linter.Config[] = require("../../eslint.config.js");

function block(name: string): Linter.Config {
  const found = config.find((c) => c.name === name);
  if (!found) throw new Error(`no ESLint block named ${name}`);
  return found;
}

/** The messages a block's rules report on `source`, linted as `file` under that block alone. */
function lint(name: string, file: string, source: string): Linter.LintMessage[] {
  const { plugins, rules } = block(name);
  return new Linter({ configType: "flat" }).verify(
    source,
    [{ files: ["**/*.ts"], languageOptions: { parser: tsparser }, ...(plugins ? { plugins } : {}), rules }],
    file,
  );
}

describe("zod/issue-path", () => {
  const file = "src/x/x.schema.ts";

  it("passes an issue that names its path, the root's included", () => {
    // Arrange
    const sources = [
      'ctx.addIssue({ code: "custom", path: ["items", i, "id"], message: "duplicate" });',
      'ctx.addIssue({ code: "custom", path: [], message: "is not a web view URL" });',
      "ctx.addIssue({ code: 'custom', path: at, message });",
      "ctx.addIssue(issue);",
      'addIssue(ctx, [["lat"], "swapped"]);',
      'ctx.addIssue({ code: "custom", "path": ["a"], message: "dup" });',
      'ctx.issues.push({ code: "custom", path: ["a"], message: "dup", input: v });',
      'ctx["addIssue"]({ code: "custom", path: [], message: "dup" });',
      'z.object({}).superRefine((v, { addIssue }) => addIssue({ code: "custom", path: ["a"], message: "m" }));',
      "items.push({ code: 'custom', message: 'not an issue list' });",
    ];

    // Act
    const reported = sources.filter((source) => lint("zod/issue-path", file, source).length > 0);

    // Assert
    expect(reported).toEqual([]);
  });

  it("rejects an issue without its own path, a spread or a nested one included, and a bare message", () => {
    // Arrange
    const sources = [
      'ctx.addIssue({ code: "custom", message: "duplicate id" });',
      'ctx.addIssue({ code: "custom", ...issue });',
      'ctx.addIssue({ code: "custom", params: { path: ["x"] }, message: "m" });',
      'ctx.addIssue("duplicate id");',
      "ctx.addIssue(`duplicate ${id}`);",
      'ctx.issues.push({ code: "custom", message: "dup", input: v });',
      'ctx["addIssue"]({ code: "custom", message: "dup" });',
      'ctx.addIssue({ code: "custom", path: undefined, message: "dup" });',
      'z.object({}).superRefine((v, { addIssue }) => addIssue({ code: "custom", message: "m" }));',
      'z.object({}).check((ctx) => { ctx.issues.push({ code: "custom", message: "m", input: ctx.value }); });',
    ];

    // Act
    const counts = sources.map((source) => lint("zod/issue-path", file, source).length);

    // Assert
    expect(counts).toEqual(sources.map(() => 1));
  });

  it("rejects an object-level refine without a path, and passes one with a path or on a field", () => {
    // Arrange
    const refusals = [
      'z.object({ a: z.string(), b: z.string() }).refine((v) => v.a !== v.b, "a and b differ");',
      "z.strictObject({ a: z.string() }).refine((v) => v.a !== '', { message: 'blank' });",
      "z.looseObject({}).refine((v) => isX(v));",
      "z.object({}).extend({ b: z.string() }).refine((v) => v.b !== '', { error: () => 'blank' });",
      "z.object({}).refine((v) => isX(v), { path: [] }).refine((v) => isY(v), { message: 'y' });",
    ];
    const passes = [
      "z.object({ start: hhmm, end: hhmm }).refine((w) => w.start !== w.end, { path: [], error: () => 'equal' });",
      "z.object({ a: z.string() }).refine((v) => v.a !== '', { message: 'blank', path: ['a'] });",
      'z.string().refine((text) => text.trim() !== "", "must be non-blank text");',
      "z.number().refine(isSkkuId);",
      "z.string().refine(isA).refine(isB);",
      "z.array(z.object({}).refine((v) => isX(v), { path: [] })).refine((all) => all.length > 0);",
    ];

    // Act
    const counts = refusals.map((source) => lint("zod/issue-path", file, source).length);
    const reported = passes.filter((source) => lint("zod/issue-path", file, source).length > 0);

    // Assert
    expect(counts).toEqual(refusals.map(() => 1));
    expect(reported).toEqual([]);
  });

  it("applies to src/ but not to its specs", () => {
    // Arrange
    const { files, ignores } = block("zod/issue-path");

    // Act & Assert
    expect(files).toEqual(["src/**/*.ts"]);
    expect(ignores).toEqual(["src/**/*.spec.ts"]);
  });
});

describe("boundaries/literals", () => {
  const file = "src/x/x.mapper.ts";

  it("rejects a hex color (with #, mixing letters and digits, or named as a color), rgb(), 0x…, and a web view path, as a string or a template", () => {
    // Arrange
    const sources = [
      'const color = "003626";',
      'const color = "#FFFFFF";',
      "const color = 'e65100';",
      "const color = `1565C0`;",
      'const path = "/skku/lostandfound";',
      "const url = `/skku/${page}`;",
      'type Color = "4CAF50";',
      'const color = "#FF003626";',
      'const tint = "FF003626";',
      'const style = { textColor: "003626" };',
      'const color = "rgb(0, 54, 38)";',
      "const color = `rgba(0, 54, 38, ${alpha})`;",
      "const color = 0x003626;",
      "const url = `${origin}/skku/lostandfound`;",
      'const path = "skku/lostandfound";',
    ];

    // Act
    const counts = sources.map((source) => lint("boundaries/literals", file, source).length);

    // Assert
    expect(counts).toEqual(sources.map(() => 1));
  });

  it("passes other strings: short or long hex, all-digit ids and all-letter words outside a color, non-hex words, other paths and a path inside a URL", () => {
    // Arrange
    const sources = [
      'const short = "#FFF";',
      'const longer = "0036261";',
      'const word = "GGGGGG";',
      'const route = "/webview";',
      'const url = "https://www.skku.edu/skku/campus/support/lost_and_found_2.do";',
      "const url = `${origin}${LOST_AND_FOUND_PATH}`;",
      "const mixed = `${a}003626`;",
      'const since = "202610";',
      'const routeId = "100100";',
      'const kind = "facade";',
      'const era = "decade";',
      "const mask = 0xff;",
      'const label = "rgb is a color model";',
      "const url = `${origin}/webview/x`;",
    ];

    // Act
    const reported = sources.filter((source) => lint("boundaries/literals", file, source).length > 0);

    // Assert
    expect(reported).toEqual([]);
  });

  it("leaves .constants files and specs out", () => {
    // Arrange
    const { ignores = [] } = block("boundaries/literals");

    // Act & Assert
    expect(ignores).toEqual(expect.arrayContaining(["src/**/*.spec.ts", "src/**/*.constants.ts"]));
  });
});

describe("schemas/no-double-cast", () => {
  const file = "src/x/x.schema.ts";

  it("rejects a cast through unknown or any in a .schema, which certifies fields the schema never checks", () => {
    // Arrange
    const sources = [
      "export const toX = (raw: Raw) => raw as unknown as XDoc;",
      "export const toY = (raw: Raw) => (raw as any) as YDoc;",
      "export const toZ = (raw: Raw) => <ZDoc>(<unknown>raw);",
    ];

    // Act
    const counts = sources.map((source) => lint("schemas/no-double-cast", file, source).length);

    // Assert
    expect(counts).toEqual(sources.map(() => 1));
  });

  it("passes a single cast and a satisfies, and leaves specs out", () => {
    // Arrange
    const source = 'export const x = z.object({}) satisfies z.ZodType<X>;\nexport const k = "a" as const;';
    const { ignores = [] } = block("schemas/no-double-cast");

    // Act & Assert
    expect(lint("schemas/no-double-cast", file, source)).toEqual([]);
    expect(ignores).toEqual(["src/**/*.spec.ts"]);
  });
});

describe("boundaries/pure-schema", () => {
  const file = "src/map/x/map-x.rules.ts";

  it("rejects a runtime import of a .schema from a .rules or .mapper file", () => {
    // Arrange
    const sources = [
      'import { webviewUrl } from "../map.schema";',
      'import { webviewUrl, type BannerImageRaw } from "./ui.schema";',
      'import * as schema from "../map.schema";',
      'import schema from "./x.schema";',
      'import "./x.schema";',
    ];

    // Act
    const counts = sources.map((source) => lint("boundaries/pure-schema", file, source).length);

    // Assert
    expect(counts).toEqual(sources.map(() => 1));
  });

  it("passes a type import of a .schema and a runtime import of anything else", () => {
    // Arrange
    const sources = [
      'import type { BannerImageRaw } from "./ui.schema";',
      'import { type A, type B } from "../map.schema";',
      'import { toWebviewUrl } from "../../infra/webview-url";',
      'import { LOST_AND_FOUND_PATH } from "../map.constants";',
    ];

    // Act
    const reported = sources.filter((source) => lint("boundaries/pure-schema", file, source).length > 0);

    // Assert
    expect(reported).toEqual([]);
  });

  it("covers .rules and .mapper files", () => {
    // Act & Assert
    expect(block("boundaries/pure-schema").files).toEqual(["src/**/*.rules.ts", "src/**/*.mapper.ts"]);
  });
});

describe("specs/fixed-clock", () => {
  it("rejects the real Clock in a spec, and passes a fixed fake", () => {
    // Arrange
    const file = "src/map/layer-set/map-layer-set.service.spec.ts";

    // Act
    const real = lint("specs/fixed-clock", file, "const service = new MapLayerSetService(repository, new Clock());");
    const fake = lint("specs/fixed-clock", file, "const clock: Clock = { now: () => NOW };\nnew MapLayerSetService(repository, clock);");

    // Assert
    expect(real).toHaveLength(1);
    expect(fake).toEqual([]);
  });

  it.each([
    ["an aliased import", 'import { Clock as RealClock } from "../../infra/clock";\nnew Service(repo, new RealClock());'],
    ["a namespace import", 'import * as clock from "../../infra/clock";\nnew clock.Clock();'],
    ["a Nest-built Clock in providers", "Test.createTestingModule({ providers: [MapLayerSetService, MapRepository, Clock] });"],
    ["a Nest-built Clock through useClass", "Test.createTestingModule({ providers: [{ provide: Clock, useClass: Clock }] });"],
  ])("rejects the real Clock through %s", (_case, source) => {
    // Act
    const messages = lint("specs/fixed-clock", "src/map/layer-set/map-layer-set.service.spec.ts", source);

    // Assert
    expect(messages).toHaveLength(1);
  });

  it.each([
    ["an alias the name check cannot see, built with new", 'import { Clock as Tick } from "../../infra/clock";\nnew Tick();'],
    ["an alias provided to Nest", 'import { Clock as Tick } from "../../infra/clock";\nTest.createTestingModule({ providers: [Tick] });'],
    ["an alias through useClass", 'import { Clock as Tick } from "../../infra/clock";\nTest.createTestingModule({ providers: [{ provide: Clock, useClass: Tick }] });'],
    ["an alias that reads as a fake", 'import { Clock as FixedClock } from "../../infra/clock";\nnew FixedClock();'],
    ["a fake class that extends the real one", "class FixedClock extends Clock {}\nnew FixedClock();"],
  ])("rejects the real Clock through %s", (_case, source) => {
    // Act
    const messages = lint("specs/fixed-clock", "src/map/layer-set/map-layer-set.service.spec.ts", source);

    // Assert
    expect(messages).toHaveLength(1);
  });

  it("passes Clock imported by its name or as a type under another", () => {
    // Act
    const messages = lint(
      "specs/fixed-clock",
      "src/map/layer-set/map-layer-set.service.spec.ts",
      'import { Clock } from "../../infra/clock";\nimport type { Clock as Now } from "../../infra/clock";\nconst clock: Clock = { now: () => NOW };',
    );

    // Assert
    expect(messages).toEqual([]);
  });

  it("passes a fake provided in place of Clock, and a fixed fake class", () => {
    // Arrange
    const file = "src/map/layer-set/map-layer-set.service.spec.ts";

    // Act
    const messages = lint(
      "specs/fixed-clock",
      file,
      "Test.createTestingModule({ providers: [{ provide: Clock, useValue: fakeClock }] });\nnew FixedClock(NOW);\nnew FakeClock(NOW);",
    );

    // Assert
    expect(messages).toEqual([]);
  });

  it("covers the module scopes' specs and route tests", () => {
    // Arrange
    const { files = [] } = block("specs/fixed-clock");

    // Act & Assert
    expect(files).toEqual(expect.arrayContaining(["src/map/**/*.spec.ts", "__tests__/nest/map/**/*.ts", "__tests__/nest/infra/**/*.ts"]));
    const scopes = moduleScopes();
    const nestModules = files.map((glob) => /^__tests__\/nest\/([^/]+)\//.exec(String(glob))?.[1]).filter((m): m is string => !!m);
    expect(nestModules.filter((m) => !scopes.includes(`src/${m}/`))).toEqual([]);
  });
});

describe("migrated/syntax-clock", () => {
  it("covers every feature module and no shared layer, from the module scopes", () => {
    // Arrange
    const scopes = moduleScopes();
    const features = scopes.filter((scope) => !SHARED_LAYERS.some((layer) => scope.startsWith(`src/${layer}/`)));

    // Act
    const { files = [] } = block("migrated/syntax-clock");

    // Assert
    expect(features.length).toBeGreaterThan(0);
    expect(files).toEqual(expect.arrayContaining(features.map((scope) => (scope.endsWith("/") ? `${scope}**/*.ts` : scope))));
    expect(files.filter((glob) => SHARED_LAYERS.some((layer) => String(glob).startsWith(`src/${layer}/`)))).toEqual([]);
  });

  it("rejects Date.now() in a feature service", () => {
    // Act
    const messages = lint("migrated/syntax-clock", "src/building/x/x.service.ts", "const at = Date.now();");

    // Assert
    expect(messages.map((m) => m.message)).toEqual([expect.stringContaining("Clock")]);
  });

  it.each([
    ["migrated/syntax-clock", "src/bus/x/bus-x.service.ts"],
    ["migrated/syntax-pure-clock", "src/bus/x/bus-x.rules.ts"],
    ["boundaries/pure", "src/bus/x/bus-x.rules.ts"],
    ["boundaries/query", "src/bus/x/bus-x.query.ts"],
  ])("%s rejects moment reading the clock, and passes moment over a given instant", (name, file) => {
    // Arrange
    const reads = ["moment();", 'moment.tz("Asia/Seoul");', "moment.tz();", "moment.utc();", "moment.now();"];
    const parses = ["moment(now);", 'moment(now).tz("Asia/Seoul");', 'moment.tz(day, "YYYY-MM-DD", "Asia/Seoul");', 'moment.tz(now, "Asia/Seoul");', "moment.utc(ms);"];

    // Act
    const counts = reads.map((source) => lint(name, file, source).length);
    const reported = parses.filter((source) => lint(name, file, source).length > 0);

    // Assert
    expect(counts).toEqual(reads.map(() => 1));
    expect(reported).toEqual([]);
  });
});

describe("readability/src", () => {
  it("rejects a comma operator, parenthesised or not, and passes a comma that separates", () => {
    // Arrange
    const file = "src/x/x.mapper.ts";

    // Act
    const packed = lint("readability/src", file, "function f(d: string[]) { return (d.push('x'), null); }");
    const bare = lint("readability/src", file, "let a = 0; let b = 0; a++, b++;");
    const separated = lint("readability/src", file, "const [a, b] = [1, 2]; f(a, b); for (let i = 0, j = 1; i < j; i++) {}");

    // Assert
    expect(packed).toHaveLength(1);
    expect(bare).toHaveLength(1);
    expect(separated).toEqual([]);
  });
});

describe("naming/generic-names", () => {
  it("rejects a name that says nothing on its own, and passes one with its domain noun", () => {
    // Arrange
    const file = "src/map/map.mapper.ts";

    // Act
    const generic = ["const info = 1;", "function f(obj: unknown) {}", "const tmp = [];", "const helper = () => 1;", "let manager;"].map(
      (source) => lint("naming/generic-names", file, source).length,
    );
    const named = lint("naming/generic-names", file, "const placeInfo = 1; const upsertResult = 2;");

    // Assert
    expect(generic).toEqual([1, 1, 1, 1, 1]);
    expect(named).toEqual([]);
  });
});
