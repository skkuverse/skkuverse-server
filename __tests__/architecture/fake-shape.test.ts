/**
 * Every fake follows one real class (harden-test-suite 3.7, tests.md). A file
 * under `__tests__/helpers/fakes/` is named `<module>/<name>.<role>.fake.ts`,
 * exactly one `src/<module>/**\/<name>.<role>.ts` exists and exports the class
 * `<Name>`, and the fake exports `class Fake<Name> implements PublicOf<<Name>>`.
 * `PublicOf` is what makes `npm run typecheck` fail when the real class gains
 * or renames a public member, so a fake without it drifts unnoticed.
 * `naming.test.ts` covers only `src/`.
 */
import ts from "typescript";
import { isExported } from "../helpers/architecture/ast";
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { filesUnder, readSource, sourceFiles } from "../helpers/architecture/tree";

const FAKES_DIR = "__tests__/helpers/fakes";
const PUBLIC_OF = `${FAKES_DIR}/public-of.ts`;
const FAKE_PATH = /^__tests__\/helpers\/fakes\/([a-z0-9-]+)\/([a-z0-9]+(?:-[a-z0-9]+)*)\.([a-z]+)\.fake\.ts$/;

/** The src/ files a fake may follow, and their text. */
export interface SrcTree {
  files: readonly string[];
  read(file: string): string;
}

const pascal = (kebab: string) =>
  kebab
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");

function exportedClass(file: string, source: string, name: string): ts.ClassDeclaration | undefined {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  return sf.statements.find(
    (s): s is ts.ClassDeclaration =>
      ts.isClassDeclaration(s) &&
      s.name?.text === name &&
      isExported(s),
  );
}

function implementsPublicOf(fake: ts.ClassDeclaration, real: string): boolean {
  return (fake.heritageClauses ?? [])
    .filter((h) => h.token === ts.SyntaxKind.ImplementsKeyword)
    .flatMap((h) => h.types)
    .some((t) => {
      const [arg] = t.typeArguments ?? [];
      return (
        ts.isIdentifier(t.expression) &&
        t.expression.text === "PublicOf" &&
        t.typeArguments?.length === 1 &&
        !!arg &&
        ts.isTypeReferenceNode(arg) &&
        ts.isIdentifier(arg.typeName) &&
        arg.typeName.text === real
      );
    });
}

/** `<fake file>: <reason>` for the first way the fake breaks the rule, or nothing. */
export function fakeShapeViolations(file: string, source: string, src: SrcTree): string[] {
  if (file === PUBLIC_OF) return [];
  const match = file.match(FAKE_PATH);
  if (!match) return [`${file}: not named <module>/<name>.<role>.fake.ts`];
  const [, module, name, role] = match as unknown as [string, string, string, string];

  const wanted = `${name}.${role}.ts`;
  const sources = src.files.filter((f) => f.startsWith(`src/${module}/`) && f.endsWith(`/${wanted}`));
  if (sources.length !== 1) {
    return [`${file}: ${sources.length} sources match src/${module}/**/${wanted}, expected 1`];
  }
  const [real] = sources as [string];

  const className = pascal(name) + pascal(role);
  if (!exportedClass(real, src.read(real), className)) return [`${file}: ${real} exports no class ${className}`];
  const fake = exportedClass(file, source, `Fake${className}`);
  if (!fake) return [`${file}: exports no class Fake${className}`];
  if (!implementsPublicOf(fake, className)) {
    return [`${file}: Fake${className} does not implement PublicOf<${className}>`];
  }
  return [];
}

describe("fake shape rule applies as specified", () => {
  const FAKE = "__tests__/helpers/fakes/building/building.repository.fake.ts";
  const REAL = "src/building/building.repository.ts";
  const REAL_SOURCE = "export class BuildingRepository implements OnModuleInit {}";
  const GOOD_FAKE = "export class FakeBuildingRepository implements PublicOf<BuildingRepository> {}";
  const tree = (sources: Record<string, string>): SrcTree => ({
    files: Object.keys(sources),
    read: (f) => sources[f]!,
  });

  it.each([
    ["the shape tests.md describes", FAKE, GOOD_FAKE, { [REAL]: REAL_SOURCE }, []],
    [
      "a source in a sub-module",
      "__tests__/helpers/fakes/building/building-sync.client.fake.ts",
      "export class FakeBuildingSyncClient implements PublicOf<BuildingSyncClient> {}",
      { "src/building/sync/building-sync.client.ts": "export class BuildingSyncClient {}" },
      [],
    ],
    ["public-of.ts, which is no fake", PUBLIC_OF, "export type PublicOf<T> = T;", {}, []],
    [
      "a wrong class name",
      FAKE,
      "export class FakeBuildingRepo implements PublicOf<BuildingRepository> {}",
      { [REAL]: REAL_SOURCE },
      [`${FAKE}: exports no class FakeBuildingRepository`],
    ],
    [
      "an unexported fake class",
      FAKE,
      "class FakeBuildingRepository implements PublicOf<BuildingRepository> {}",
      { [REAL]: REAL_SOURCE },
      [`${FAKE}: exports no class FakeBuildingRepository`],
    ],
    [
      "no implements PublicOf",
      FAKE,
      "export class FakeBuildingRepository {}",
      { [REAL]: REAL_SOURCE },
      [`${FAKE}: FakeBuildingRepository does not implement PublicOf<BuildingRepository>`],
    ],
    [
      "PublicOf of another class",
      FAKE,
      "export class FakeBuildingRepository implements PublicOf<BusRepository> {}",
      { [REAL]: REAL_SOURCE },
      [`${FAKE}: FakeBuildingRepository does not implement PublicOf<BuildingRepository>`],
    ],
    [
      "the real class implemented directly",
      FAKE,
      "export class FakeBuildingRepository implements BuildingRepository {}",
      { [REAL]: REAL_SOURCE },
      [`${FAKE}: FakeBuildingRepository does not implement PublicOf<BuildingRepository>`],
    ],
    [
      "no matching source",
      FAKE,
      GOOD_FAKE,
      { "src/bus/building.repository.ts": REAL_SOURCE },
      [`${FAKE}: 0 sources match src/building/**/building.repository.ts, expected 1`],
    ],
    [
      "two matching sources",
      FAKE,
      GOOD_FAKE,
      { [REAL]: REAL_SOURCE, "src/building/sync/building.repository.ts": REAL_SOURCE },
      [`${FAKE}: 2 sources match src/building/**/building.repository.ts, expected 1`],
    ],
    [
      "a source that exports another class",
      FAKE,
      GOOD_FAKE,
      { [REAL]: "export class BuildingRepo {}" },
      [`${FAKE}: ${REAL} exports no class BuildingRepository`],
    ],
    [
      "no module folder",
      "__tests__/helpers/fakes/building.repository.fake.ts",
      GOOD_FAKE,
      { [REAL]: REAL_SOURCE },
      ["__tests__/helpers/fakes/building.repository.fake.ts: not named <module>/<name>.<role>.fake.ts"],
    ],
    [
      "no .fake suffix",
      "__tests__/helpers/fakes/building/building.repository.ts",
      GOOD_FAKE,
      { [REAL]: REAL_SOURCE },
      ["__tests__/helpers/fakes/building/building.repository.ts: not named <module>/<name>.<role>.fake.ts"],
    ],
  ])("%s", (_case, file, source, sources, expected) => {
    // Act & Assert
    expect(fakeShapeViolations(file, source, tree(sources))).toEqual(expected);
  });
});

describe("fake shape", () => {
  it("names every fake after the one src/ class it implements through PublicOf", () => {
    // Arrange
    const src: SrcTree = { files: sourceFiles(), read: readSource };

    // Act
    const violations = filesUnder(FAKES_DIR).flatMap((f) => fakeShapeViolations(f, readSource(f), src));

    // Assert
    expectAllowlisted("fake-shape", violations);
  });
});
