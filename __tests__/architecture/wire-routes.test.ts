/**
 * Every client-facing route declares what it sends through a `.wire` type
 * (ADR 0010, D13; define-boundary-contracts design D4), so `tsc` ties the
 * response to the schema that is published for it.
 *
 * A handler's declared return type, inside `Promise<…>`, must reference a
 * type imported from a `.wire` file. A handler that adds `meta` declares
 * `WithMeta<T, M>`, and both `T` and `M` must reference one: a `WithMeta`
 * without its `M` sends `meta` nobody published.
 *
 * Exempt: `internal/*` (crawler and console callers), `health`, and a handler
 * that takes `@Res()` and writes its own response (the attachment stream). A
 * `@Res()` handler that sends the envelope through `sendSuccess` still serves
 * JSON to a client, so it is checked, and its `void` return fails until its
 * module is migrated. A `@Res({ passthrough: true })` handler returns its
 * payload like any other.
 *
 * The allowlist holds the routes that predate the rule; each refactor group
 * clears its own, and a new route is never on it.
 */
import ts from "typescript";
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { routeHandlersIn, type RouteHandler } from "../helpers/architecture/routes";
import { readSource, sourceFiles } from "../helpers/architecture/tree";

const isWireSpecifier = (specifier: string) => /\.wire$/.test(specifier);

const isExemptPath = (path: string) => path === "health" || path.startsWith("health/") || path.startsWith("internal/");

/** The local names a file binds from `.wire` imports: named, default and namespace. */
function wireImports(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || !isWireSpecifier(s.moduleSpecifier.text)) {
      continue;
    }
    const clause = s.importClause;
    if (clause?.name) names.add(clause.name.text);
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) bindings.elements.forEach((e) => names.add(e.name.text));
  }
  return names;
}

const leftmost = (name: ts.EntityName): string => (ts.isIdentifier(name) ? name.text : leftmost(name.left));

/** Whether a type names a wire import anywhere: `X`, `Wire.X`, `X[]`, `X | null`, `typeof x`. */
function referencesWire(type: ts.Node, wire: ReadonlySet<string>): boolean {
  if (ts.isTypeReferenceNode(type) && wire.has(leftmost(type.typeName))) return true;
  if (ts.isTypeQueryNode(type) && wire.has(leftmost(type.exprName))) return true;
  if (
    ts.isImportTypeNode(type) &&
    ts.isLiteralTypeNode(type.argument) &&
    ts.isStringLiteral(type.argument.literal) &&
    isWireSpecifier(type.argument.literal.text)
  ) {
    return true;
  }
  return ts.forEachChild(type, (child) => referencesWire(child, wire) || undefined) ?? false;
}

const isReference = (type: ts.TypeNode | undefined, name: string): type is ts.TypeReferenceNode =>
  !!type && ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && type.typeName.text === name;

/** The types that declare what a handler sends: `T` and `M` of `WithMeta<T, M>`, else the return type, inside `Promise`. */
function payloadTypes(handler: ts.MethodDeclaration): Array<ts.TypeNode | undefined> {
  let type = handler.type;
  if (isReference(type, "Promise")) type = type.typeArguments?.[0];
  if (isReference(type, "WithMeta")) return [type.typeArguments?.[0], type.typeArguments?.[1]];
  return [type];
}

const decoratorNamed = (node: ts.HasDecorators, name: string): ts.CallExpression | undefined =>
  (ts.getDecorators(node) ?? [])
    .map((d) => d.expression)
    .find((e): e is ts.CallExpression => ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === name);

function callsSendSuccess(node: ts.Node): boolean {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "sendSuccess") return true;
  return ts.forEachChild(node, (child) => callsSendSuccess(child) || undefined) ?? false;
}

function writesOwnResponse(handler: ts.MethodDeclaration): boolean {
  const res = handler.parameters.map((p) => decoratorNamed(p, "Res") ?? decoratorNamed(p, "Response")).find(Boolean);
  if (!res || res.arguments.length > 0) return false;
  return !handler.body || !callsSendSuccess(handler.body);
}

/** The routes in one file that serve JSON to a client: not internal, not health, not a raw response. */
export function clientRoutes(file: string, source: string): RouteHandler[] {
  return routeHandlersIn(file, source).filter((r) => !isExemptPath(r.path) && !writesOwnResponse(r.handler));
}

/** `<METHOD> <path>` for each client-facing route whose payload type, or `meta` type, names no `.wire` type. */
export function unwiredRoutes(file: string, source: string): string[] {
  return clientRoutes(file, source)
    .filter((r) => {
      const wire = wireImports(r.handler.getSourceFile());
      return !payloadTypes(r.handler).every((type) => type !== undefined && referencesWire(type, wire));
    })
    .map((r) => `${r.method} ${r.path}`);
}

describe("wire-routes rule applies as specified", () => {
  const imports = [
    'import type { XDetail, XList, XSearchData, XSearchMeta } from "./x.wire";',
    'import type * as SharedWire from "../x.wire";',
    'import type { XInternal, XMetaCounts } from "./x.types";',
  ].join("\n");
  const controller = (prefix: string, handlers: string) =>
    `${imports}\n@Controller("${prefix}")\nexport class XController {\n${handlers}\n}`;

  it("passes a return type that names a wire type, inside Promise, a union, a namespace or WithMeta<T, M>", () => {
    // Arrange
    const source = controller(
      "x",
      [
        '  @Get("list") list(): Promise<XList> {}',
        '  @Get(":id") detail(): Promise<XDetail | null> {}',
        '  @Get("shared") shared(): SharedWire.XShared[] {}',
        '  @Get("search") search(): Promise<WithMeta<XSearchData, XSearchMeta>> {}',
      ].join("\n"),
    );

    // Act & Assert
    expect(unwiredRoutes("src/x/x.controller.ts", source)).toEqual([]);
  });

  it("fails a return type that names no wire type, void, or none at all", () => {
    // Arrange
    const source = controller(
      "x",
      [
        '  @Get("internal-shape") a(): Promise<XInternal> {}',
        '  @Get("void") b(): void {}',
        '  @Post("none") c() {}',
        '  @Get("readonly") d(): Promise<Readonly<XInternal>> {}',
      ].join("\n"),
    );

    // Act & Assert
    expect(unwiredRoutes("src/x/x.controller.ts", source)).toEqual([
      "GET x/internal-shape",
      "GET x/void",
      "POST x/none",
      "GET x/readonly",
    ]);
  });

  it("fails a WithMeta whose M is unwired or missing, and one whose T is unwired", () => {
    // Arrange
    const source = controller(
      "x",
      [
        '  @Get("unwired-meta") a(): Promise<WithMeta<XSearchData, XMetaCounts>> {}',
        '  @Get("no-meta-type") b(): Promise<WithMeta<XSearchData>> {}',
        '  @Get("unwired-data") c(): WithMeta<XInternal, XSearchMeta> {}',
      ].join("\n"),
    );

    // Act & Assert
    expect(unwiredRoutes("src/x/x.controller.ts", source)).toEqual([
      "GET x/unwired-meta",
      "GET x/no-meta-type",
      "GET x/unwired-data",
    ]);
  });

  it("exempts internal/*, health and a @Res() handler that writes its own response", () => {
    // Arrange
    const source = [
      controller("internal/x", '  @Post("send") send(): Promise<XInternal> {}'),
      '@Controller("health")\nexport class HealthController {\n  @Get() health(@Res() res: Response): void {}\n  @Get("ready") ready(): void {}\n}',
      '@Controller("x")\nexport class XFileController {\n  @Get("file") file(@Res() res: Response): Promise<void> { return pipeDownload(res); }\n}',
    ].join("\n");

    // Act & Assert
    expect(unwiredRoutes("src/x/x.controller.ts", source)).toEqual([]);
  });

  it("checks a @Res() handler that sends the envelope, and a passthrough one by its return type", () => {
    // Arrange
    const source = controller(
      "x",
      [
        '  @Get("etag") etag(@Req() req: Request, @Res() res: Response): void { sendSuccess(req, res, {}); }',
        '  @Get("pass") pass(@Res({ passthrough: true }) res: Response): Promise<XList> {}',
        '  @Get("pass-unwired") passUnwired(@Res({ passthrough: true }) res: Response): Promise<XInternal> {}',
      ].join("\n"),
    );

    // Act & Assert
    expect(unwiredRoutes("src/x/x.controller.ts", source)).toEqual(["GET x/etag", "GET x/pass-unwired"]);
  });
});

describe("routes", () => {
  it("declare what they send to a client through a .wire type", () => {
    // Arrange
    const files = sourceFiles();

    // Act
    const checked = files.flatMap((f) => clientRoutes(f, readSource(f)));
    const unwired = files.flatMap((f) => unwiredRoutes(f, readSource(f)));

    // Assert
    // An empty route list would pass the rule vacuously.
    expect(checked.length).toBeGreaterThan(20);
    expectAllowlisted("wire-routes", unwired);
  });
});
