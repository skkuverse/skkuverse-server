/**
 * How the build carries the perimeter overlay (ADR 0023, D4): the build empties dist/ before it compiles, so an
 * entry left by an earlier build (a removed overlay, a stale private one) can never load; the overlay entry, which
 * only a load by path reaches, is a knip entry so its tree counts as used; and the package is private, so no publish
 * can ship a build that carries a production overlay.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.join(__dirname, "../../..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { private?: boolean; scripts: Record<string, string> };
const knip = JSON.parse(fs.readFileSync(path.join(root, "knip.json"), "utf8")) as { entry: string[] };

describe("the perimeter build", () => {
  it("empties dist/ first, so a stale overlay entry from an earlier build cannot load", () => {
    // Arrange
    const [clean, ...rest] = pkg.scripts.build!.split(" && ");
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "perimeter-build-"));
    const stale = path.join(scratch, "dist/src/private/perimeter.overlay.js");
    fs.mkdirSync(path.dirname(stale), { recursive: true });
    fs.writeFileSync(stale, "module.exports = {};");

    try {
      // Act
      execFileSync("/bin/sh", ["-c", clean!], { cwd: scratch });

      // Assert
      expect(fs.existsSync(path.join(scratch, "dist"))).toBe(false);
      expect(rest[0]).toBe("tsc -p tsconfig.build.json");
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("makes the overlay entry a knip entry, since only a load by path reaches it", () => {
    // Act & Assert
    expect(knip.entry).toContain("src/perimeter/current/perimeter.overlay.ts");
  });

  it("is a private package", () => {
    // Act & Assert
    expect(pkg.private).toBe(true);
  });
});
