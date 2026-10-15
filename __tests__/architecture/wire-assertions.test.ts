/**
 * Every route that declares a published wire schema has a route test that
 * checks a real response against it (PR 234 F7, option A). `tsc` lets a
 * handler return more than its wire type declares, and `wire-routes` reads only
 * the declared type, so without this a body can drift from its contract with
 * every suite green.
 *
 * The routes and their schemas come from the contract index
 * (`contracts/produced/index.json`): each pair of a route and a schema its
 * payload types reference (both `T` and `M` of `WithMeta<T, M>`). A pair is
 * covered when one test body under `__tests__/nest/` holds a URL literal that
 * the route's path matches and calls `expectWire(<schema>, …)` with that
 * schema imported from its `.wire` file. A URL is a string or template literal
 * starting with `/`; a template's substitution stands for one path segment,
 * and a query string is allowed. A URL two routes match counts for the one
 * with more static segments, as Nest's route order serves it. The method is
 * not matched.
 *
 * Routes that declare no wire type (`internal/*` without one, `health`, the
 * attachment stream) have no schema to check; `wire-routes` decides which
 * routes must declare one. The rule is strict: no route is exempt.
 */
import ts from "typescript";
import { importsOf, parseSource } from "../helpers/architecture/ast";
import { parseTestFile } from "../helpers/architecture/tests";
import { filesUnder, readSource } from "../helpers/architecture/tree";
import { contractIndex, sourceRoutes, wireModules, wireSchemas } from "../helpers/contracts/artifacts";

/** `<repo path of the .wire.ts>#<export>`, as a test imports it and the index names it. */
type SchemaKey = string;

/** A route and a schema it serves, `<METHOD> <path> <schema key>`. */
type Pair = string;

const pairOf = (route: string, schema: SchemaKey): Pair => `${route} ${schema}`;

/** Each route of the index paired with each schema that serves it. */
function requiredPairs(index: Readonly<Record<string, { source: string; export: string; routes: string[] }>>): Pair[] {
  return Object.values(index).flatMap((entry) => entry.routes.map((route) => pairOf(route, `${entry.source}#${entry.export}`)));
}

/** Matches a URL the route serves: its static segments as written, one segment per `:param`, an optional query. */
function routePattern(routePath: string): RegExp {
  const segments = routePath
    .split("/")
    .filter(Boolean)
    .map((s) => (s.startsWith(":") ? "[^/?]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  return new RegExp(`^/${segments.join("/")}(?:\\?.*)?$`);
}

const PLACEHOLDER = "\u0001";

/** The URL literals in a test body: strings and templates opening with `/`, each substitution one placeholder segment. */
function urlLiterals(body: ts.Node): string[] {
  const urls: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) urls.push(node.text);
    if (ts.isTemplateExpression(node)) {
      urls.push(node.head.text + node.templateSpans.map((span) => PLACEHOLDER + span.literal.text).join(""));
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return urls.filter((url) => url.startsWith("/"));
}

/** Local name → wire file, for each value a file imports from a `.wire` module; a namespace import maps to its file. */
function wireImports(source: ts.SourceFile): { named: Map<string, SchemaKey>; namespaces: Map<string, string> } {
  const named = new Map<string, SchemaKey>();
  const namespaces = new Map<string, string>();
  for (const i of importsOf(source)) {
    if (i.kind !== "import" || i.isType || !i.target.endsWith(".wire")) continue;
    if (i.imported === "*") namespaces.set(i.local, `${i.target}.ts`);
    else named.set(i.local, `${i.target}.ts#${i.imported}`);
  }
  return { named, namespaces };
}

/** The wire schemas the first argument of each `expectWire(…)` in a body names, wrapped (`z.array(x)`) or not. */
function assertedSchemas(body: ts.Node, imports: ReturnType<typeof wireImports>): SchemaKey[] {
  const keys: SchemaKey[] = [];
  const visitArg = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && imports.named.has(node.text)) keys.push(imports.named.get(node.text)!);
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && imports.namespaces.has(node.expression.text)) {
      keys.push(`${imports.namespaces.get(node.expression.text)!}#${node.name.text}`);
    }
    ts.forEachChild(node, visitArg);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "expectWire" && node.arguments[0]) {
      visitArg(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return keys;
}

const staticSegments = (routePath: string) => routePath.split("/").filter((s) => s && !s.startsWith(":")).length;

/** The route paths a URL reaches: of those whose pattern matches it, the ones with the most static segments, as Nest's order puts `notices/source/:id` before `notices/:id/:no`. */
function reachedPaths(url: string, routePaths: readonly string[]): string[] {
  const matching = routePaths.filter((p) => routePattern(p).test(url));
  const most = Math.max(...matching.map(staticSegments));
  return matching.filter((p) => staticSegments(p) === most);
}

/** The pairs one test file covers: a body that requests the route's URL and checks the schema. */
function coveredPairs(file: string, text: string, required: readonly Pair[]): Pair[] {
  const source = parseSource(file, text);
  const imports = wireImports(source);
  const routePaths = [...new Set(required.map((pair) => pair.split(" ")[1]!))];
  const bodies = parseTestFile(file, text)
    .calls.map((c) => c.body)
    .filter((b): b is NonNullable<typeof b> => b !== null);
  const covered = new Set<Pair>();
  for (const body of bodies) {
    const reached = new Set(urlLiterals(body).flatMap((url) => reachedPaths(url, routePaths)));
    const schemas = new Set(assertedSchemas(body, imports));
    for (const pair of required) {
      const [, routePath, schema] = pair.split(" ") as [string, string, SchemaKey];
      if (schemas.has(schema) && reached.has(routePath)) covered.add(pair);
    }
  }
  return [...covered];
}

/** The required pairs no test file covers. */
function uncoveredPairs(required: readonly Pair[], tests: ReadonlyArray<{ file: string; text: string }>): Pair[] {
  const covered = new Set(tests.flatMap((t) => coveredPairs(t.file, t.text, required)));
  return required.filter((pair) => !covered.has(pair));
}

describe("wire-assertions rule applies as specified", () => {
  const FILE = "test/x.routes.test.ts";
  const WIRE = "src/x/x.wire.ts";
  const required = [pairOf("GET x/list", `${WIRE}#xList`), pairOf("GET x/:id", `${WIRE}#xDetail`), pairOf("GET x/:id", `${WIRE}#xDetailMeta`)];
  const imports = [
    'import { xDetail, xList } from "../src/x/x.wire";',
    'import * as XWire from "../src/x/x.wire";',
    'import type { XDetailMeta } from "../src/x/x.wire";',
  ].join("\n");
  const testFile = (body: string) => `${imports}\nit("serves", async () => {\n${body}\n});`;

  it("matches a route's static segments, one segment per param, and an optional query", () => {
    // Act
    const pattern = routePattern("notices/:sourceId/:articleNo");

    // Assert
    expect(["/notices/a/1", "/notices/a/1?lang=en", `/notices/${PLACEHOLDER}/${PLACEHOLDER}`].map((u) => pattern.test(u))).toEqual([true, true, true]);
    expect(["/notices/a", "/notices/a/1/2", "notices/a/1", "/noticesX/a/1"].map((u) => pattern.test(u))).toEqual([false, false, false, false]);
  });

  it("sends a URL to the matching route with the most static segments", () => {
    // Act
    const reached = ["/x/list", "/x/7", "/y"].map((url) => reachedPaths(url, ["x/:id", "x/list"]));

    // Assert
    expect(reached).toEqual([["x/list"], ["x/:id"], []]);
  });

  it("covers a pair when one body requests the route and checks the schema, by name, wrapped or through a namespace", () => {
    // Arrange
    const tests = [
      { file: FILE, text: testFile('const res = await get("/x/list?limit=1");\nexpectWire(xList, res.body.data);') },
      { file: FILE, text: testFile("const res = await get(`/x/${id}`);\nexpectWire(z.array(xDetail), [res.body.data]);\nexpectWire(XWire.xDetailMeta, res.body.meta);") },
    ];

    // Act & Assert
    expect(uncoveredPairs(required, tests)).toEqual([]);
  });

  it("fails a pair whose request and check sit in different bodies, a check on another route, or a type-only name", () => {
    // Arrange
    const split = `${imports}\nit("a", async () => { await get("/x/list"); });\nit("b", () => { expectWire(xList, body); });`;
    const tests = [
      { file: FILE, text: split },
      { file: FILE, text: testFile('const res = await get("/x/list");\nexpectWire(xDetail, res.body.data);\nexpectWire(XDetailMeta, res.body.meta);') },
      { file: FILE, text: testFile('const url = "x/1";\nexpectWire(xDetail, data);') },
    ];

    // Act & Assert
    expect(uncoveredPairs(required, tests)).toEqual(required);
  });
});

describe("routes that declare a wire schema", () => {
  it("each have a route test that checks a response against every schema they declare", () => {
    // Arrange
    const required = requiredPairs(contractIndex(wireSchemas(wireModules()), sourceRoutes()));
    const tests = filesUnder("__tests__/nest")
      .filter((f) => f.endsWith(".test.ts"))
      .map((file) => ({ file, text: readSource(file) }));

    // Act
    const uncovered = uncoveredPairs(required, tests);

    // Assert
    // An empty pair list would pass the rule vacuously.
    expect(required.length).toBeGreaterThan(30);
    expect(uncovered).toEqual([]);
  });
});
