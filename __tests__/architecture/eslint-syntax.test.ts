/**
 * The syntax rules that run beside the role blocks (eslint.config.js), each an
 * alias of no-restricted-syntax under the local `src-syntax` plugin so a
 * block that sets one leaves the rest alone:
 *
 *   - `zod/issue-path`: every `ctx.addIssue({ … })` in src/ names its `path`
 *     (`path: []` when the issue is the whole value), since parseConfigFile
 *     and the boot error print it; a bare message string is refused too.
 *     Specs may build a pathless issue to test how one is answered.
 *   - `boundaries/literals`: a six-digit hex color (`003626`, `#FFFFFF`) or
 *     a web view path (`/skku/…`) appears only in a `*.constants.ts` file
 *     (or JSON). Specs state the values they expect and are left out. Its
 *     `ignores` lists the unmigrated files that broke it when it was added;
 *     import-boundaries.test.ts fails when one is fixed.
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
    [{ files: ["**/*.ts"], languageOptions: { parser: tsparser }, plugins, rules }],
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

  it("rejects a hex color, bare or with #, and a web view path, as a string or a template", () => {
    // Arrange
    const sources = [
      'const color = "003626";',
      'const color = "#FFFFFF";',
      "const color = 'e65100';",
      "const color = `1565C0`;",
      'const path = "/skku/lostandfound";',
      "const url = `/skku/${page}`;",
      'type Color = "4CAF50";',
    ];

    // Act
    const counts = sources.map((source) => lint("boundaries/literals", file, source).length);

    // Assert
    expect(counts).toEqual(sources.map(() => 1));
  });

  it("passes other strings: short or long hex, non-hex words, other paths and a path inside a URL", () => {
    // Arrange
    const sources = [
      'const short = "#FFF";',
      'const longer = "0036261";',
      'const word = "GGGGGG";',
      'const route = "/webview";',
      'const url = "https://www.skku.edu/skku/campus/support/lost_and_found_2.do";',
      "const url = `${origin}${LOST_AND_FOUND_PATH}`;",
      "const mixed = `${a}003626`;",
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
