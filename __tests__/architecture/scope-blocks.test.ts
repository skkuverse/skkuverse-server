/**
 * The ESLint blocks that hold the module scopes cover all of them (ADR 0010
 * D9: "a new module is bound from its first file"; PR 255 F1). Nothing else
 * checks a block's `files` or a glob in its `ignores`, so one narrowed glob
 * would free a whole module from its role caps, its TypeScript rules or a
 * boundary while every other architecture test passes.
 *
 * For the blocks named `size/<role>`, `size-ratchets/migrated`,
 * `migrated/…`, `naming/generic-names`, `specs/fixed-clock` and
 * `boundaries/…`:
 *
 *   - `files` holds each glob rebuilt here from `moduleScopes()`, the way
 *     eslint.config.js builds it, not read back from the config: a scope
 *     block covers every scope's files of its role, a `src/**` boundary block
 *     all of `src/`, and the feature boundaries every depth of every feature
 *     that holds a file;
 *   - `ignores` holds only a role glob over all of `src/` (`**\/*.<role>.ts`
 *     or `src/**\/*.<role>.ts`), the two Mongo owners or a vendored source
 *     (`.contracts.lock.json`).
 *
 * The root module's size is the one file whose cap rises with the module
 * count; it keeps its role block and takes its own `size-caps.json` entry, so
 * no block ignores it.
 */
import { Linter } from "eslint";
import { SHARED_LAYERS } from "../helpers/architecture/ast";
import { vendoredSources } from "../helpers/architecture/comments";
import { ROLES } from "../helpers/architecture/names";
import { moduleScopes } from "../helpers/architecture/scopes";
import { filesUnder } from "../helpers/architecture/tree";

const config: Linter.Config[] = require("../../eslint.config.js");

const PURE_TAILS = [".rules.ts", ".mapper.ts", ".query.ts"];
const MONGO_OWNERS = ["src/infra/db.ts", "src/infra/mongo.ts"];
const FEATURE_DEPTHS = 5;
// The boundary blocks over one shared layer, each by the folder it holds to.
const LAYER_BY_BLOCK: Readonly<Record<string, string>> = {
  "boundaries/shared": "shared",
  "boundaries/infra": "infra",
  "boundaries/http": "http",
  "boundaries/perimeter-layer": "perimeter",
};
// The boundary blocks over named folders of a shared layer, each by the folders it holds to.
const FOLDERS_BY_BLOCK: Readonly<Record<string, readonly string[]>> = {
  "boundaries/perimeter-implementations": ["perimeter/current", "perimeter/local-dev"],
};
const ROLE_GLOB = /^(?:src\/)?\*\*\/\*\.(?:([a-z]+)|\{([a-z,]+)\})\.ts$/;

/** `src/<m>/**\/*<tail>` per scope folder, and each root file that ends in `<tail>`. */
export function scopeGlobs(scopes: readonly string[], tail: string): string[] {
  return scopes.flatMap((scope) => (scope.endsWith("/") ? [`${scope}**/*${tail}`] : scope.endsWith(tail) ? [scope] : []));
}

/** The specs of each scope, and a top-level module's `__tests__/nest/<m>/` tests. */
function scopeSpecGlobs(scopes: readonly string[]): string[] {
  return scopes.flatMap((scope) => {
    if (!scope.endsWith("/")) return [scope.replace(/\.ts$/, ".spec.ts")];
    return [`${scope}**/*.spec.ts`, `__tests__/nest/${scope.slice("src/".length, -1)}/**/*.ts`];
  });
}

/** The globs a block must list, or undefined for a block this rule does not read. */
export function requiredGlobs(name: string, scopes: readonly string[]): string[] | undefined {
  const role = /^size\/([a-z]+)$/.exec(name)?.[1];
  if (role !== undefined) return scopeGlobs(scopes, `.${role}.ts`);
  if (["size-ratchets/migrated", "migrated/typescript", "naming/generic-names"].includes(name)) return scopeGlobs(scopes, ".ts");
  if (name === "specs/fixed-clock") return scopeSpecGlobs(scopes);
  const feature = /^boundaries\/feature\/([^/]+)\/depth-(\d+)$/.exec(name);
  if (feature !== null) return [`src/${feature[1]}/${"*/".repeat(Number(feature[2]) - 1)}*.ts`];
  const layer = LAYER_BY_BLOCK[name];
  if (layer !== undefined) return [`src/${layer}/**/*.ts`];
  const folders = FOLDERS_BY_BLOCK[name];
  if (folders !== undefined) return folders.map((folder) => `src/${folder}/**/*.ts`);
  // The migrated/syntax blocks split the scopes between a pair (with and without the clock ban); the pair is read below.
  return name.startsWith("boundaries/") || name.startsWith("migrated/") ? [] : undefined;
}

/** `<block>: <problem>` for each scope block whose files miss a scope or whose ignores free a file they should not. */
export function scopeBlockProblems(blocks: readonly Linter.Config[], scopes: readonly string[], vendored: ReadonlySet<string>): string[] {
  const named = blocks.filter((b): b is Linter.Config & { name: string } => typeof b.name === "string");
  const filesOf = (b: Linter.Config): string[] => (b.files ?? []).map(String);
  const problems: string[] = [];
  for (const block of named) {
    const required = requiredGlobs(block.name, scopes);
    if (required === undefined) continue;
    const files = filesOf(block);
    for (const glob of required) if (!files.includes(glob)) problems.push(`${block.name}: files miss ${glob}`);
    const isSrcWide =
      block.name.startsWith("boundaries/") && !block.name.startsWith("boundaries/feature/") && LAYER_BY_BLOCK[block.name] === undefined && FOLDERS_BY_BLOCK[block.name] === undefined;
    if (isSrcWide) for (const glob of files) if (!glob.startsWith("src/**/")) problems.push(`${block.name}: files narrow src/ to ${glob}`);
    for (const ignored of (block.ignores ?? []).map(String)) {
      const roles = ROLE_GLOB.exec(ignored);
      const roleNames = roles === null ? [] : (roles[1] ?? roles[2] ?? "").split(",");
      const isRoleGlob = roleNames.length > 0 && roleNames.every((r) => r === "spec" || ROLES.has(r));
      if (!isRoleGlob && !MONGO_OWNERS.includes(ignored) && !vendored.has(ignored)) problems.push(`${block.name}: ignores ${ignored}`);
    }
  }
  const union = (prefix: string): string[] => named.filter((b) => b.name === prefix || b.name === `${prefix}-clock`).flatMap(filesOf);
  const pairs: Array<[string, string[]]> = [
    ["migrated/syntax", scopeGlobs(scopes, ".ts")],
    ["migrated/syntax-controller", scopeGlobs(scopes, ".controller.ts")],
    ["migrated/syntax-pure", PURE_TAILS.flatMap((tail) => scopeGlobs(scopes, tail))],
  ];
  for (const [prefix, required] of pairs) {
    const files = union(prefix);
    for (const glob of required) if (!files.includes(glob)) problems.push(`${prefix}(-clock): files miss ${glob}`);
  }
  const features = scopes.filter((s) => s.endsWith("/") && !SHARED_LAYERS.includes(s.slice("src/".length, -1)));
  for (const scope of features) {
    for (let depth = 1; depth <= FEATURE_DEPTHS; depth += 1) {
      const name = `boundaries/feature/${scope.slice("src/".length, -1)}/depth-${depth}`;
      if (!named.some((b) => b.name === name)) problems.push(`${name}: missing`);
    }
  }
  return problems;
}

/** Files under a feature deeper than the feature boundary blocks reach. */
export function tooDeep(srcFiles: readonly string[]): string[] {
  return srcFiles.filter((f) => f.endsWith(".ts") && f.split("/").length - 2 > FEATURE_DEPTHS && !SHARED_LAYERS.includes(f.split("/")[1] ?? ""));
}

describe("scope block rule applies as specified", () => {
  const scopes = ["src/app.module.ts", "src/building/", "src/infra/", "src/notices/"];
  const none = new Set<string>();
  const block = (name: string, files: string[], ignores?: string[]): Linter.Config => ({ name, files, ...(ignores ? { ignores } : {}) });
  const covering = (): Linter.Config[] => [
    block("size/module", scopeGlobs(scopes, ".module.ts")),
    block("migrated/typescript", scopeGlobs(scopes, ".ts"), ["src/**/*.spec.ts", "src/notices/notices.topics.ts"]),
    block("migrated/syntax", ["src/infra/**/*.ts"], ["**/*.spec.ts", "**/*.rules.ts"]),
    block("migrated/syntax-clock", ["src/app.module.ts", "src/building/**/*.ts", "src/notices/**/*.ts"]),
    block("migrated/syntax-controller-clock", scopeGlobs(scopes, ".controller.ts")),
    block("migrated/syntax-pure-clock", PURE_TAILS.flatMap((t) => scopeGlobs(scopes, t))),
    block("boundaries/get-client", ["src/**/*.ts"], ["src/**/*.repository.ts", "src/infra/db.ts", "src/infra/mongo.ts"]),
    ...["building", "notices"].flatMap((f) => [1, 2, 3, 4, 5].map((d) => block(`boundaries/feature/${f}/depth-${d}`, [`src/${f}/${"*/".repeat(d - 1)}*.ts`]))),
    block("layer-set-leaves", ["src/map/x.ts"], ["src/map/**/*.{rules,mapper}.ts"]),
  ];

  it("passes blocks that cover every scope and ignore only role globs, the Mongo owners and vendored sources", () => {
    // Act & Assert
    expect(scopeBlockProblems(covering(), scopes, new Set(["src/notices/notices.topics.ts"]))).toEqual([]);
  });

  it.each([
    ["a module's folder glob in a block's ignores", "migrated/typescript", (b: Linter.Config) => ({ ...b, ignores: [...(b.ignores ?? []), "src/notices/**"] })],
    ["a single file in a block's ignores", "boundaries/get-client", (b: Linter.Config) => ({ ...b, ignores: [...(b.ignores ?? []), "src/building/building.service.ts"] })],
    ["files narrowed to leave a module out", "migrated/typescript", (b: Linter.Config) => ({ ...b, files: (b.files ?? []).filter((g) => !String(g).startsWith("src/notices/")) })],
    ["a role cap without the root module", "size/module", (b: Linter.Config) => ({ ...b, files: ["src/building/**/*.module.ts"] })],
    ["a src-wide boundary narrowed to one module", "boundaries/get-client", (b: Linter.Config) => ({ ...b, files: ["src/building/**/*.ts"] })],
    ["the syntax pair without a module", "migrated/syntax-clock", (b: Linter.Config) => ({ ...b, files: ["src/building/**/*.ts"] })],
    ["a feature's deepest boundary", "boundaries/feature/notices/depth-5", () => undefined],
  ])("refuses %s", (_case, name, edit) => {
    // Arrange
    const blocks = covering().flatMap((b) => {
      if (b.name !== name) return [b];
      const edited = edit(b);
      return edited === undefined ? [] : [edited];
    });

    // Act
    const problems = scopeBlockProblems(blocks, scopes, none);

    // Assert
    expect(problems.length).toBeGreaterThan(0);
  });

  // WHY: src/http/ reaches the perimeter through its ports alone (ADR 0023, D8), a layer rule like src/infra/'s.
  it("reads a boundary over src/http/ as it reads the ones over src/shared/ and src/infra/", () => {
    // Arrange
    const whole = [...covering(), block("boundaries/http", ["src/http/**/*.ts"])];
    const narrowed = [...covering(), block("boundaries/http", ["src/http/x.middleware.ts"])];

    // Act & Assert
    expect(requiredGlobs("boundaries/http", scopes)).toEqual(["src/http/**/*.ts"]);
    expect(scopeBlockProblems(whole, scopes, new Set(["src/notices/notices.topics.ts"]))).toEqual([]);
    expect(scopeBlockProblems(narrowed, scopes, none).length).toBeGreaterThan(0);
  });

  // WHY: src/perimeter/ imports no feature (ADR 0023, D8), a layer rule like src/shared/'s.
  it("reads a boundary over src/perimeter/ as it reads the ones over src/shared/ and src/infra/", () => {
    // Arrange
    const whole = [...covering(), block("boundaries/perimeter-layer", ["src/perimeter/**/*.ts"])];
    const narrowed = [...covering(), block("boundaries/perimeter-layer", ["src/perimeter/current/*.ts"])];

    // Act & Assert
    expect(requiredGlobs("boundaries/perimeter-layer", scopes)).toEqual(["src/perimeter/**/*.ts"]);
    expect(scopeBlockProblems(whole, scopes, new Set(["src/notices/notices.topics.ts"]))).toEqual([]);
    expect(scopeBlockProblems(narrowed, scopes, none).length).toBeGreaterThan(0);
  });

  // WHY: an implementation leaves for the overlay (ADR 0023, D4), so the rule holds both implementation folders whole.
  it("reads the boundary over the perimeter's implementation folders as a boundary over both, whole", () => {
    // Arrange
    const both = ["src/perimeter/current/**/*.ts", "src/perimeter/local-dev/**/*.ts"];
    const whole = [...covering(), block("boundaries/perimeter-implementations", both)];
    const narrowed = [...covering(), block("boundaries/perimeter-implementations", ["src/perimeter/current/**/*.ts"])];

    // Act & Assert
    expect(requiredGlobs("boundaries/perimeter-implementations", scopes)).toEqual(both);
    expect(scopeBlockProblems(whole, scopes, new Set(["src/notices/notices.topics.ts"]))).toEqual([]);
    expect(scopeBlockProblems(narrowed, scopes, none).length).toBeGreaterThan(0);
  });

  it("reads a file past the feature boundaries' depth", () => {
    // Act & Assert
    expect(tooDeep(["src/bus/a/b/c/d/bus-x.ts", "src/bus/a/b/c/d/e/bus-x.ts", "src/infra/a/b/c/d/e/x.ts"])).toEqual(["src/bus/a/b/c/d/e/bus-x.ts"]);
  });
});

describe("the ESLint scope blocks", () => {
  it("cover every module scope, and ignore no scope's file but by role", () => {
    // Arrange
    const scopes = moduleScopes();

    // Act
    const problems = scopeBlockProblems(config, scopes, vendoredSources());

    // Assert
    expect(scopes.length).toBeGreaterThan(0);
    expect(problems).toEqual([]);
    expect(tooDeep(filesUnder("src"))).toEqual([]);
  });
});
