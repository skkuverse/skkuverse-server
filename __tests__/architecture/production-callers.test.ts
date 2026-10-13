/**
 * A public method is public because production code calls it (ADR 0010, D4).
 * A fake implements every public member (`PublicOf`, fake-shape.test.ts), so a
 * method made public only for a spec spreads into the fakes and the contract.
 *
 * In a migrated scope, each public method of a class in a `.service.ts`,
 * `.repository.ts` or `.client.ts` (Nest lifecycle hooks aside) is named, as
 * `<expression>.<method>`, in a non-spec `src/` file other than its own. The
 * match is by name, not by type, so a method sharing a name with another
 * class's counts as called.
 *
 * A method that only a spec calls is made private, and its spec drives the
 * behavior through the public one; a reasoned exemption
 * (`exemptions/production-callers.json`) is for a method that is public for
 * something other than a spec.
 */
import ts from "typescript";
import { expectExempted } from "../helpers/architecture/exemptions";
import { inScope, migratedScopes } from "../helpers/architecture/migrated";
import { readSource, sourceFiles } from "../helpers/architecture/tree";

const CLASS_ROLE = /\.(?:service|repository|client)\.ts$/;
const LIFECYCLE = new Set(["onModuleInit", "onModuleDestroy", "onApplicationBootstrap", "beforeApplicationShutdown", "onApplicationShutdown"]);

const isNonPublic = (m: ts.ClassElement): boolean =>
  (m.name !== undefined && ts.isPrivateIdentifier(m.name)) ||
  (ts.canHaveModifiers(m) ? ts.getModifiers(m) ?? [] : []).some(
    (mod) => mod.kind === ts.SyntaxKind.PrivateKeyword || mod.kind === ts.SyntaxKind.ProtectedKeyword,
  );

/** `Class.method` for each public method of the classes a source declares. */
export function publicMethods(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  return sf.statements.filter(ts.isClassDeclaration).flatMap((cls) =>
    cls.members
      .filter((m): m is ts.MethodDeclaration => ts.isMethodDeclaration(m) && ts.isIdentifier(m.name))
      .filter((m) => !isNonPublic(m) && !LIFECYCLE.has(m.name.getText(sf)))
      .map((m) => `${cls.name?.text ?? "(anonymous)"}.${m.name.getText(sf)}`),
  );
}

/** The property names a source reaches as `<expression>.<name>`. */
export function accessedNames(file: string, source: string): Set<string> {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const names = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n)) names.add(n.name.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return names;
}

/** `<file>: Class.method` for each public method no other non-spec source names. */
export function uncalledMethods(sources: ReadonlyMap<string, string>, scopes: readonly string[]): string[] {
  const accessed = new Map([...sources].map(([file, source]) => [file, accessedNames(file, source)]));
  return [...sources]
    .filter(([file]) => CLASS_ROLE.test(file) && scopes.some((scope) => inScope(file, scope)))
    .flatMap(([file, source]) =>
      publicMethods(file, source)
        .filter((qualified) => {
          const method = qualified.slice(qualified.indexOf(".") + 1);
          return ![...accessed].some(([other, names]) => other !== file && names.has(method));
        })
        .map((qualified) => `${file}: ${qualified}`),
    );
}

describe("production caller rule applies as specified", () => {
  const SERVICE = `
@Injectable()
export class XService {
  constructor(private readonly repository: XRepository) {}
  onModuleInit(): void {}
  list(): string[] { return this.load(new Date()); }
  load(now: Date): string[] { return []; }
  private helper(): void {}
  protected guarded(): void {}
  #hidden(): void {}
}`;

  it("lists the public methods, lifecycle hooks and private members aside", () => {
    // Act & Assert
    expect(publicMethods("src/x/x.service.ts", SERVICE)).toEqual(["XService.list", "XService.load"]);
  });

  it("flags a public method that only its own file names, and checks only class roles in the scopes", () => {
    // Arrange
    const sources = new Map([
      ["src/x/x.service.ts", SERVICE],
      ["src/x/x.controller.ts", "export class XController { get() { return this.service.list(); } }"],
      ["src/z/z.service.ts", "export class ZService { orphan(): void {} }"],
      ["src/x/x.mapper.ts", "export class Helper { orphan(): void {} }"],
    ]);

    // Act
    const violations = uncalledMethods(sources, ["src/x/"]);

    // Assert
    expect(violations).toEqual(["src/x/x.service.ts: XService.load"]);
  });

  it("counts a method passed by reference, not only one called", () => {
    // Arrange
    const sources = new Map([
      ["src/x/x.service.ts", SERVICE],
      ["src/x/x.controller.ts", "export class C { a = () => this.service.list(); b = this.service.load; }"],
    ]);

    // Act & Assert
    expect(uncalledMethods(sources, ["src/x/"])).toEqual([]);
  });
});

describe("services, repositories and clients in migrated scopes", () => {
  it("expose only methods that production code calls", () => {
    // Arrange
    const sources = new Map(sourceFiles().map((f) => [f, readSource(f)]));

    // Act
    const violations = uncalledMethods(sources, migratedScopes());

    // Assert
    expectExempted("production-callers", violations);
  });
});
