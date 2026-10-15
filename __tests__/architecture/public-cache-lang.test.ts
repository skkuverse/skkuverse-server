/**
 * A response a shared cache may store does not depend on the request's
 * language (umbrella issue spencer0124/skkuverse#63). Cloudflare's cache key
 * leaves out `Accept-Language` and it does not honor `Vary` on these
 * responses: measured 2026-10-14, `/map/overlays/campus` with
 * `Accept-Language: en` came back HIT carrying `ko`. A language-dependent
 * response is therefore `private` (or `no-store`), never `public`; varying
 * would not help.
 *
 * Code that reads the language is a route handler with a `@Lang()`, `@Req()`
 * or `@Headers()` parameter, or any function with a `SupportedLang`
 * parameter. Such code declares no shared-cacheable `Cache-Control` (one with
 * `public` or `s-maxage`): not in a `@CacheControl(…)` on it, not in a
 * `Cache-Control` it sets on the response (`setHeader`, `set`, `header`), and
 * not as the third argument of a `withEtag(…)` it returns. A value is a
 * string or template literal, a `const` under src/ bound to one (every
 * binding of that name counts), or a conditional of those; any other value
 * cannot be checked and fails as if it were public.
 *
 * The envelope's half of the decision, no `meta.lang` on a shared-cacheable
 * response, is `src/http/response.interceptor.spec.ts`.
 */
import ts from "typescript";
import { calleeName, collect, parseSource, skipOuter } from "../helpers/architecture/ast";
import { sourceFiles, readSource } from "../helpers/architecture/tree";

const LANGUAGE_PARAMS = new Set(["Lang", "Req", "Headers"]);
const HEADER_SETTERS = new Set(["setHeader", "set", "header"]);

type FunctionLike = ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression;

const isFunctionLike = (n: ts.Node): n is FunctionLike =>
  ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n);

const decoratorName = (d: ts.Decorator): string | undefined =>
  ts.isCallExpression(d.expression) && ts.isIdentifier(d.expression.expression) ? d.expression.expression.text : undefined;

/** The string-valued `const` bindings under src/, by name: what a cache policy identifier can resolve to. */
export function constBindings(sources: ReadonlyMap<string, string>): Map<string, ts.Expression[]> {
  const out = new Map<string, ts.Expression[]>();
  for (const [file, source] of sources) {
    for (const d of collect(parseSource(file, source), ts.isVariableDeclaration)) {
      if (!ts.isIdentifier(d.name) || d.initializer === undefined) continue;
      if (!(ts.getCombinedNodeFlags(d) & ts.NodeFlags.Const)) continue;
      out.set(d.name.text, [...(out.get(d.name.text) ?? []), d.initializer]);
    }
  }
  return out;
}

/** The values an expression may hold, `${}` standing for a substitution; `undefined` when one cannot be known. */
function valuesOf(expression: ts.Expression, consts: ReadonlyMap<string, ts.Expression[]>, seen = new Set<string>()): string[] | undefined {
  const e = skipOuter(expression);
  if (ts.isStringLiteralLike(e)) return [e.text];
  if (ts.isTemplateExpression(e)) return [e.head.text + e.templateSpans.map((s) => "${}" + s.literal.text).join("")];
  if (ts.isConditionalExpression(e)) {
    const [a, b] = [valuesOf(e.whenTrue, consts, seen), valuesOf(e.whenFalse, consts, seen)];
    return a && b ? [...a, ...b] : undefined;
  }
  if (!ts.isIdentifier(e) || seen.has(e.text) || !consts.has(e.text)) return undefined;
  const parts = consts.get(e.text)!.map((init) => valuesOf(init, consts, new Set([...seen, e.text])));
  return parts.every((p) => p !== undefined) ? parts.flat() : undefined;
}

export const isSharedCacheable = (value: string): boolean =>
  value.split(",").some((d) => ["public", "s-maxage"].includes(d.trim().split("=")[0]!.toLowerCase()));

/** The cache policy expressions a function declares: its `@CacheControl`, the headers it sets, its `withEtag` policy. */
function policiesOf(fn: FunctionLike): ts.Expression[] {
  const decorated = ts.isMethodDeclaration(fn)
    ? (ts.getDecorators(fn) ?? []).filter((d) => decoratorName(d) === "CacheControl").flatMap((d) => (d.expression as ts.CallExpression).arguments.slice(0, 1))
    : [];
  const calls = fn.body === undefined ? [] : collect(fn.body, ts.isCallExpression);
  const headers = calls.filter((c) => {
    const [name, value] = c.arguments;
    return HEADER_SETTERS.has(calleeName(c) ?? "") && name !== undefined && value !== undefined && ts.isStringLiteralLike(name) && name.text.toLowerCase() === "cache-control";
  });
  const etags = calls.filter((c) => calleeName(c) === "withEtag" && c.arguments.length >= 3);
  return [...decorated, ...headers.map((c) => c.arguments[1]!), ...etags.map((c) => c.arguments[2]!)];
}

const readsLanguage = (fn: FunctionLike): boolean =>
  fn.parameters.some(
    (p) =>
      (p.type !== undefined && p.type.getText() === "SupportedLang") ||
      (ts.canHaveDecorators(p) && (ts.getDecorators(p) ?? []).some((d) => LANGUAGE_PARAMS.has(decoratorName(d) ?? ""))),
  );

/** `<file>:<line> <value>` for each shared-cacheable (or unknowable) cache policy that code reading the language declares. */
export function publicLanguagePolicies(sources: ReadonlyMap<string, string>): string[] {
  const consts = constBindings(sources);
  return [...sources].flatMap(([file, source]) => {
    const sf = parseSource(file, source);
    return collect(sf, isFunctionLike)
      .filter(readsLanguage)
      .flatMap(policiesOf)
      .flatMap((policy) => {
        const values = valuesOf(policy, consts);
        if (values !== undefined && !values.some(isSharedCacheable)) return [];
        const where = `${file}:${sf.getLineAndCharacterOfPosition(policy.getStart(sf)).line + 1}`;
        return [`${where} ${values === undefined ? `unresolved ${policy.getText(sf)}` : values.join(" | ")}`];
      });
  });
}

describe("public-cache-lang rule applies as specified", () => {
  const controller = (body: string): Map<string, string> =>
    new Map([
      ["src/x/x.constants.ts", 'export const X_CACHE = "public, max-age=300";\nexport const X_PRIVATE = `private, max-age=${60}`;'],
      ["src/x/x.controller.ts", `@Controller("x")\nexport class XController {\n${body}\n}`],
    ]);

  it("flags a public @CacheControl on a handler that reads the language, through a constant", () => {
    // Arrange
    const sources = controller('  @Get()\n  @CacheControl(X_CACHE)\n  get(@Lang() lang: SupportedLang) { return lang; }');

    // Act & Assert
    expect(publicLanguagePolicies(sources)).toEqual(["src/x/x.controller.ts:4 public, max-age=300"]);
  });

  it("passes a private policy, and a public one on a handler that does not read the language", () => {
    // Arrange
    const sources = controller(
      [
        '  @Get("a")\n  @CacheControl(X_PRIVATE)\n  a(@Lang() lang: SupportedLang) { return lang; }',
        '  @Get("b")\n  @CacheControl(X_CACHE)\n  b() { return 1; }',
      ].join("\n"),
    );

    // Act & Assert
    expect(publicLanguagePolicies(sources)).toEqual([]);
  });

  it("flags a public withEtag policy or response header in a function with a SupportedLang parameter, and an unknown value", () => {
    // Arrange
    const sources = new Map([
      [
        "src/y/y.service.ts",
        [
          "export class YService {",
          "  get(id: string, lang: SupportedLang) { return withEtag(data, `\"${id}\"`, `public, max-age=${N}`); }",
          '  set(res: Response, lang: SupportedLang) { res.setHeader("Cache-Control", ok ? "no-store" : "s-maxage=60"); }',
          '  raw(@Req() req: Request) { res.set("cache-control", policyFor(req)); }',
          "}",
        ].join("\n"),
      ],
    ]);

    // Act & Assert
    expect(publicLanguagePolicies(sources)).toEqual([
      "src/y/y.service.ts:2 public, max-age=${}",
      "src/y/y.service.ts:3 no-store | s-maxage=60",
      "src/y/y.service.ts:4 unresolved policyFor(req)",
    ]);
  });

  it.each([
    ["public, max-age=60", true],
    ["max-age=60, s-maxage=600", true],
    ["private, max-age=3600", false],
    ["no-store", false],
  ])("reads %s as shared-cacheable: %s", (value, expected) => {
    // Act & Assert
    expect(isSharedCacheable(value)).toBe(expected);
  });
});

describe("routes under src/", () => {
  it("declare no shared-cacheable Cache-Control on a response that depends on the language", () => {
    // Arrange
    const sources = new Map(sourceFiles().map((f) => [f, readSource(f)]));

    // Act
    const violations = publicLanguagePolicies(sources);

    // Assert
    expect([...sources.values()].some((s) => s.includes("@Lang()"))).toBe(true);
    expect(violations).toEqual([]);
  });
});
