/**
 * A public method is public because production code calls it (ADR 0010, D4).
 * A fake implements every public member (`PublicOf`, fake-shape.test.ts), so a
 * method made public only for a spec spreads into the fakes and the contract.
 *
 * In a migrated scope, each public method of a class in a `.service.ts`,
 * `.repository.ts` or `.client.ts` (Nest lifecycle hooks aside) is named, as
 * `<expression>.<method>`, in a non-spec `src/` file other than its own. The
 * type checker resolves each access, so a method sharing a name with another
 * class's (`this.cache.get()` for `XRepository.get`) is not a call of it.
 *
 * A method that only a spec calls is made private, and its spec drives the
 * behavior through the public one; a reasoned exemption
 * (`exemptions/production-callers.json`) is for a method that is public for
 * something other than a spec.
 */
import path from "path";
import ts from "typescript";
import { NEST_LIFECYCLE, isNonPublic } from "../helpers/architecture/ast";
import { expectExempted } from "../helpers/architecture/exemptions";
import { inScope, migratedScopes } from "../helpers/architecture/migrated";
import { readSource, sourceFiles } from "../helpers/architecture/tree";

const CLASS_ROLE = /\.(?:service|repository|client)\.ts$/;

/**
 * The lib's mapped types a reader names a class through. Without a lib, `Pick<Class, "m">` resolves to nothing, so a
 * call through it would reach no declaration.
 */
const LIB_STUB = "type Pick<T, K extends keyof T> = { [P in K]: T[P] };";

/** A type-checked program over in-memory sources: relative imports resolve among them, packages stay unresolved. */
function programOf(sources: ReadonlyMap<string, string>): ts.Program {
  const options: ts.CompilerOptions = { noLib: true, types: [], experimentalDecorators: true, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10 };
  const files = new Map([...sources].map(([file, source]) => [path.posix.join("/", file), source]));
  files.set("/lib.d.ts", LIB_STUB);
  const host: ts.CompilerHost = {
    getSourceFile: (name) => {
      const source = files.get(name);
      return source === undefined ? undefined : ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    },
    getDefaultLibFileName: () => "/lib.d.ts",
    writeFile: () => undefined,
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (name) => files.has(name),
    readFile: (name) => files.get(name),
    directoryExists: () => true,
  };
  return ts.createProgram([...files.keys()], options, host);
}

const repoPath = (sf: ts.SourceFile): string => sf.fileName.replace(/^\//, "");

/** `Class.method` for each public method of the classes a source declares. */
export function publicMethods(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  return sf.statements.filter(ts.isClassDeclaration).flatMap((cls) =>
    cls.members
      .filter((m): m is ts.MethodDeclaration => ts.isMethodDeclaration(m) && ts.isIdentifier(m.name))
      .filter((m) => !isNonPublic(m) && !NEST_LIFECYCLE.has(m.name.getText(sf)))
      .map((m) => `${cls.name?.text ?? "(anonymous)"}.${m.name.getText(sf)}`),
  );
}

/**
 * `<file>: Class.method` for each public method no other non-spec source reaches. A reach is a property access the
 * type checker resolves to that method (`this.service.list()`, `this.service.load` by reference), so another class's
 * method of the same name does not count.
 */
export function uncalledMethods(sources: ReadonlyMap<string, string>, scopes: readonly string[]): string[] {
  const program = programOf(sources);
  const checker = program.getTypeChecker();
  const reachedFrom = new Map<ts.Declaration, Set<string>>();
  for (const sf of program.getSourceFiles()) {
    const visit = (n: ts.Node): void => {
      if (ts.isPropertyAccessExpression(n)) {
        for (const d of checker.getSymbolAtLocation(n.name)?.declarations ?? []) {
          reachedFrom.set(d, (reachedFrom.get(d) ?? new Set()).add(repoPath(sf)));
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return program
    .getSourceFiles()
    .filter((sf) => CLASS_ROLE.test(sf.fileName) && scopes.some((scope) => inScope(repoPath(sf), scope)))
    .flatMap((sf) => {
      const file = repoPath(sf);
      return sf.statements.filter(ts.isClassDeclaration).flatMap((cls) =>
        cls.members
          .filter((m): m is ts.MethodDeclaration => ts.isMethodDeclaration(m) && ts.isIdentifier(m.name))
          .filter((m) => !isNonPublic(m) && !NEST_LIFECYCLE.has(m.name.getText(sf)))
          .filter((m) => ![...(reachedFrom.get(m) ?? [])].some((other) => other !== file))
          .map((m) => `${file}: ${cls.name?.text ?? "(anonymous)"}.${m.name.getText(sf)}`),
      );
    });
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
      ["src/x/x.controller.ts", 'import { XService } from "./x.service";\nexport class XController { constructor(private readonly service: XService) {} get() { return this.service.list(); } }'],
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
      ["src/x/x.controller.ts", 'import { XService } from "./x.service";\nexport class C { constructor(private readonly service: XService) {} a = () => this.service.list(); b = this.service.load; }'],
    ]);

    // Act & Assert
    expect(uncalledMethods(sources, ["src/x/"])).toEqual([]);
  });

  it("counts a call through a Pick of the class, as a door's reader types it", () => {
    // Arrange
    const sources = new Map([
      ["src/x/x.service.ts", "export class XService { isX(value: string): boolean { return value !== \"\"; } orphan(): void {} }"],
      ["src/y/y.types.ts", 'import type { XService } from "../x/x.service";\nexport type XReader = Pick<XService, "isX">;'],
      ["src/y/y.config.ts", 'import type { XReader } from "./y.types";\nexport const check = (reader: XReader): boolean => reader.isX("a");'],
    ]);

    // Act & Assert
    expect(uncalledMethods(sources, ["src/x/"])).toEqual(["src/x/x.service.ts: XService.orphan"]);
  });
});

describe("production caller rule resolves the receiver", () => {
  it("does not count another class's method of the same name", () => {
    // Arrange
    const sources = new Map([
      ["src/x/x.repository.ts", "export class XRepository { get(): number { return 1; } clear(): void {} }"],
      ["src/y/y.cache.ts", "export class Cache { get(): number { return 2; } }"],
      [
        "src/y/y.service.ts",
        'import { Cache } from "./y.cache";\nimport { XRepository } from "../x/x.repository";\nexport class YService {\n  constructor(private readonly cache: Cache, private readonly repository: XRepository) {}\n  run(): number { this.repository.clear(); return this.cache.get(); }\n}',
      ],
    ]);

    // Act
    const violations = uncalledMethods(sources, ["src/x/"]);

    // Assert
    expect(violations).toEqual(["src/x/x.repository.ts: XRepository.get"]);
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
