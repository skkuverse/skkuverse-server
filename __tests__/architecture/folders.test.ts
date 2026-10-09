/**
 * A folder below a top-level src/ folder is one of two things (ADR 0010, D3):
 *
 *   - a Nest sub-module: it holds its own `*.module.ts`;
 *   - a static-asset folder: it holds JSON files only (read by a sibling
 *     `*.config.ts`).
 *
 * Layer folders (`controllers/`) and grab-bag folders are neither.
 */
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { dirsUnder, filesUnder } from "../helpers/architecture/tree";

export function folderViolation(dir: string, filesBelow: readonly string[]): boolean {
  const direct = filesBelow.filter((f) => !f.slice(dir.length + 1).includes("/"));
  if (direct.some((f) => f.endsWith(".module.ts"))) return false;
  const jsonOnly = filesBelow.length > 0 && filesBelow.every((f) => f.endsWith(".json"));
  return !jsonOnly;
}

describe("folder rule applies as specified", () => {
  it("accepts a sub-module and a JSON asset folder", () => {
    expect(folderViolation("src/bus/eta", ["src/bus/eta/eta.module.ts", "src/bus/eta/eta.service.ts"])).toBe(
      false,
    );
    expect(folderViolation("src/map/config", ["src/map/config/eskara-2026.json"])).toBe(false);
    expect(
      folderViolation("src/miniapps/details", ["src/miniapps/details/a.json", "src/miniapps/details/b/c.json"]),
    ).toBe(false);
  });

  it("rejects a layer folder, a mixed folder and a module file one level down", () => {
    expect(folderViolation("src/bus/controllers", ["src/bus/controllers/x.controller.ts"])).toBe(true);
    expect(
      folderViolation("src/bus/registry", ["src/bus/registry/a.json", "src/bus/registry/a.config.ts"]),
    ).toBe(true);
    expect(folderViolation("src/bus/x", ["src/bus/x/y/y.module.ts"])).toBe(true);
  });
});

describe("src/ folders", () => {
  it("are sub-modules or JSON asset folders", () => {
    const files = filesUnder("src");
    const nested = dirsUnder("src").filter((d) => d.split("/").length > 2);
    expectAllowlisted(
      "folders",
      nested
        .filter((d) => folderViolation(d, files.filter((f) => f.startsWith(`${d}/`))))
        .map((d) => `${d}/`),
    );
  });
});
