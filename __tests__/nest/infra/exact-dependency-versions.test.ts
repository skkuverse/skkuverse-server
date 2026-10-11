/**
 * Every dependency in package.json is pinned to an exact version (CLAUDE.md,
 * Rules: "Dependencies are pinned to exact versions"). `.npmrc` sets
 * `save-exact`, but only for `npm install`; a range typed or pasted into
 * package.json by hand still lands. This fails on any range,
 * tag or URL in dependencies, devDependencies, optionalDependencies and
 * overrides, and lists the offenders.
 */
import fs from "fs";
import path from "path";

const root = path.join(__dirname, "../../..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as Record<
  string,
  unknown
>;

const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "overrides"];

/** `section.name` → version spec; nested override objects are walked. */
function specs(value: unknown, prefix: string, out: Map<string, unknown>): void {
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) specs(child, `${prefix}.${key}`, out);
  } else {
    out.set(prefix, value);
  }
}

describe("exact dependency versions in package.json", () => {
  it("accepts an exact version and rejects ranges and tags", () => {
    // Act & Assert
    for (const spec of ["0.23.1", "11.1.24", "1.0.0-rc.1"]) expect(spec).toMatch(EXACT);
    for (const spec of ["^0.23.1", "~1.2.3", ">=1.0.0", "1.x", "1", "*", "latest", ""]) {
      expect(spec).not.toMatch(EXACT);
    }
  });

  it("pins every dependency exactly", () => {
    // Act
    const all = new Map<string, unknown>();
    for (const section of SECTIONS) {
      if (pkg[section] !== undefined) specs(pkg[section], section, all);
    }
    const offenders = [...all]
      .filter(([, spec]) => typeof spec !== "string" || !EXACT.test(spec))
      .map(([name, spec]) => `${name}: ${JSON.stringify(spec)}`);

    // Assert
    expect(offenders).toEqual([]);
  });
});
