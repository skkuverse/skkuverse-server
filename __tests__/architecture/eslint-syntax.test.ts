/**
 * The syntax rules that run beside the role blocks (eslint.config.js), each an
 * alias of no-restricted-syntax under the local `src-syntax` plugin so a
 * block that sets one leaves the rest alone:
 *
 *   - `zod/issue-path`: every issue src/ hands zod names its `path`
 *     (`path: []` when the issue is the whole value), since parseConfigFile
 *     and the boot error print it: `ctx.addIssue({ … })`, `ctx["addIssue"]`,
 *     a destructured `addIssue({ … })` and `ctx.issues.push({ … })`; a bare
 *     message string and `path: undefined` are refused too. Specs may build
 *     a pathless issue to test how one is answered.
 *   - `boundaries/literals`: a hex color (`#FFFFFF`, `#FF003626`, a bare
 *     hex that mixes letters and digits, or any bare hex bound to a name
 *     ending in `color`), an `rgb()` string, a `0x…` color number or a web
 *     view path (`/skku/…`, `${origin}/skku/…`) appears only in a
 *     `*.constants.ts` file (or JSON). Specs state the values they expect
 *     and are left out. Its
 *     `ignores` lists the unmigrated files that broke it when it was added;
 *     import-boundaries.test.ts fails when one is fixed.
 *   - `readability/src`: no comma operator in src/, parenthesised or not
 *     (`return (dropped.push(reason), null)` packs two steps into one).
 *   - `naming/generic-names`: in a migrated scope's sources, no name that
 *     says nothing on its own (`info`, `obj`, `tmp`, `helper`, `manager`).
 *   - `specs/fixed-clock`: a spec in a migrated scope (and a top-level
 *     module's `__tests__/nest/<module>/` tests) never constructs the real
 *     `Clock`; it passes a fixed fake, so one answer reads one instant and
 *     does not depend on the day the test runs.
 */
import { Linter } from "eslint";

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

  it("covers the migrated scopes' specs and route tests, not an unmigrated module's", () => {
    // Arrange
    const { files = [] } = block("specs/fixed-clock");

    // Act & Assert
    expect(files).toEqual(expect.arrayContaining(["src/map/**/*.spec.ts", "__tests__/nest/map/**/*.ts", "__tests__/nest/infra/**/*.ts"]));
    expect(files.some((glob) => String(glob).includes("bus"))).toBe(false);
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
