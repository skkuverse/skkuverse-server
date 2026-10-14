/**
 * A role file whose test sits next to it has that test (ADR 0011, D1):
 * `x.rules.ts` → `x.rules.spec.ts` in the same folder. The roles are the pure
 * ones, `.rules`, `.mapper`, `.schema` and the shared `.util`, and the
 * adapters, `.repository`, `.client` and `.poller`. A `.rules` file always
 * holds a function (role-contents.test.ts), so it always needs a spec.
 *
 * The other roles are tested elsewhere or by judgment: a controller and a
 * module by the route and architecture tests, a `.wire` by
 * `__tests__/contracts/`, a `.query` through its repository's spec (no new
 * structure pins), and a `.service` by a spec only when it composes more than
 * a delegation.
 *
 * The rule is strict: no allowlist, and no list may hold an entry under src/
 * (scope-entries.test.ts).
 */
import { EXEMPT, parse } from "../helpers/architecture/names";
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { filesUnder } from "../helpers/architecture/tree";

const RULE = "sibling-specs";

export const SPEC_ROLES = new Set(["rules", "mapper", "schema", "util", "repository", "client", "poller"]);

function needsSpec(file: string): boolean {
  if (!file.startsWith("src/") || !file.endsWith(".ts") || file.endsWith(".spec.ts")) return false;
  if (file.includes(".generated.") || EXEMPT.has(file)) return false;
  const { parts } = parse(file);
  return parts.length > 1 && SPEC_ROLES.has(parts.at(-1)!);
}

/** Each role file under src/ without its sibling spec, sorted. */
export function missingSpecs(files: readonly string[]): string[] {
  const present = new Set(files);
  return files
    .filter(needsSpec)
    .filter((file) => !present.has(file.replace(/\.ts$/, ".spec.ts")))
    .sort();
}

describe("sibling spec rule applies as specified", () => {
  it.each([...SPEC_ROLES])("fails a .%s file without its spec", (role) => {
    // Arrange
    const file = `src/x/x.${role}.ts`;

    // Act & Assert
    expect(missingSpecs([file])).toEqual([file]);
  });

  it("passes a role file whose spec sits next to it, in a module root and in a sub-module", () => {
    // Arrange
    const files = ["src/x/x.mapper.ts", "src/x/x.mapper.spec.ts", "src/x/y/x-y.schema.ts", "src/x/y/x-y.schema.spec.ts"];

    // Act & Assert
    expect(missingSpecs(files)).toEqual([]);
  });

  it("counts no spec in another folder, under another name or under __tests__/", () => {
    // Arrange
    const files = [
      "src/x/x.rules.ts",
      "src/x/y/x.rules.spec.ts",
      "src/x/x.rule.spec.ts",
      "src/x/x.spec.ts",
      "__tests__/x/x.rules.spec.ts",
    ];

    // Act & Assert
    expect(missingSpecs(files)).toEqual(["src/x/x.rules.ts"]);
  });

  it("asks nothing of the roles tested elsewhere, of generated and exempt files, or outside src/", () => {
    // Arrange
    const files = [
      "src/x/x.controller.ts",
      "src/x/x.module.ts",
      "src/x/x.service.ts",
      "src/x/x.query.ts",
      "src/x/x.wire.ts",
      "src/x/x.types.ts",
      "src/x/x.document.ts",
      "src/x/x.constants.ts",
      "src/x/x.config.ts",
      "src/x/x.schema.generated.ts",
      "src/infra/db.ts",
      "src/main.ts",
      "scripts/lib/x.rules.ts",
    ];

    // Act & Assert
    expect(missingSpecs(files)).toEqual([]);
  });

  it("asks a spec of each .util file in src/shared/, next to it", () => {
    // Arrange
    const files = ["src/shared/a.util.ts", "src/shared/a.util.spec.ts", "src/shared/b.util.ts", "src/shared/b.types.ts"];

    // Act & Assert
    expect(missingSpecs(files)).toEqual(["src/shared/b.util.ts"]);
  });

  it("asks a spec of every .rules file, one of constants only included, and of a mapper of constants", () => {
    // Arrange
    const files = ["src/a/a.rules.ts", "src/b/b.rules.ts", "src/d/d.mapper.ts"];

    // Act
    const missing = missingSpecs(files);

    // Assert
    expect(missing).toEqual(["src/a/a.rules.ts", "src/b/b.rules.ts", "src/d/d.mapper.ts"]);
  });
});

describe("src/ role files", () => {
  it("have a sibling spec", () => {
    // Act & Assert
    expectAllowlisted(RULE, missingSpecs(filesUnder("src")));
  });
});
