/**
 * A service in a migrated scope has its spec (ADR 0011, D1): `x.service.ts`
 * → `x.service.spec.ts` in the same folder, over fakes. A service that only
 * delegates (a door that forwards to its repository, a call into a mapper the
 * mapper's spec covers) is exempt instead, in
 * `exemptions/service-specs.json` with the reason (helpers/architecture/
 * exemptions.ts): the reason is what review checks, so a service that grows
 * a decision loses its exemption there.
 *
 * Modules not yet migrated are not checked, so there is no allowlist.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { expectExempted, readExemptions } from "../helpers/architecture/exemptions";
import { inScope, migratedScopes } from "../helpers/architecture/migrated";
import { filesUnder } from "../helpers/architecture/tree";

const RULE = "service-specs";

/** Each `.service.ts` in a scope without its sibling spec, sorted. */
export function servicesWithoutSpecs(files: readonly string[], scopes: readonly string[]): string[] {
  const present = new Set(files);
  return files
    .filter((file) => file.startsWith("src/") && file.endsWith(".service.ts"))
    .filter((file) => scopes.some((scope) => inScope(file, scope)))
    .filter((file) => !present.has(file.replace(/\.ts$/, ".spec.ts")))
    .sort();
}

describe("service spec rule applies as specified", () => {
  it("asks a spec of each service in a scope, next to it, and nothing outside the scopes", () => {
    // Arrange
    const files = [
      "src/a/a.service.ts",
      "src/a/a.service.spec.ts",
      "src/a/b/a-b.service.ts",
      "src/a/c/a-c.service.ts",
      "src/a/c/other.service.spec.ts",
      "src/a/a.mapper.ts",
      "src/z/z.service.ts",
      "__tests__/nest/a/a.service.ts",
    ];

    // Act & Assert
    expect(servicesWithoutSpecs(files, ["src/a/"])).toEqual(["src/a/b/a-b.service.ts", "src/a/c/a-c.service.ts"]);
  });

  describe("an exemption file", () => {
    let dir: string;
    const write = (body: unknown): void => fs.writeFileSync(path.join(dir, "rule.json"), JSON.stringify(body));
    const reason = "pure delegation: forwards each call to the repository unchanged";

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "exemptions-"));
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("exempts the listed paths and reads a missing file as none", () => {
      // Arrange
      write({ "src/a/a.service.ts": reason });

      // Act & Assert
      expect(() => expectExempted("rule", ["src/a/a.service.ts"], dir)).not.toThrow();
      expect(readExemptions("missing", dir)).toEqual(new Map());
    });

    it("fails a violation it does not list, and a listed path that no longer violates", () => {
      // Arrange
      write({ "src/a/a.service.ts": reason });

      // Act & Assert
      expect(() => expectExempted("rule", ["src/a/a.service.ts", "src/b/b.service.ts"], dir)).toThrow(/src\/b\/b\.service\.ts/);
      expect(() => expectExempted("rule", [], dir)).toThrow(/Delete these[\s\S]*src\/a\/a\.service\.ts/);
    });

    it.each([
      ["an empty reason", { "src/a/a.service.ts": "" }],
      ["a short reason", { "src/a/a.service.ts": "delegation" }],
      ["a long reason of too few words", { "src/a/a.service.ts": "delegation-to-the-repository-and-the-mapper-only" }],
      ["a reason that is not a string", { "src/a/a.service.ts": true }],
      ["an array", ["src/a/a.service.ts"]],
      ["unsorted paths", { "src/b/b.service.ts": reason, "src/a/a.service.ts": reason }],
    ])("is refused with %s", (_case, body) => {
      // Arrange
      write(body);

      // Act & Assert
      expect(() => readExemptions("rule", dir)).toThrow(/rule\.json/);
    });
  });
});

describe("services in migrated scopes", () => {
  it("have a sibling spec or a reasoned exemption", () => {
    // Act & Assert
    expectExempted(RULE, servicesWithoutSpecs(filesUnder("src"), migratedScopes()));
  });
});
