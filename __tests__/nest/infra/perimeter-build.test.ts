/**
 * How the build carries the perimeter overlay (ADR 0023, D4): the build empties dist/ before it compiles, so an
 * entry left by an earlier build (a removed overlay, a stale private one) can never load; the overlay entry, which
 * only a load by path reaches, is a knip entry so its tree counts as used; and the package is private, so no publish
 * can ship a build that carries a production overlay.
 */
import { execFileSync, spawnSync } from "node:child_process";
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

/** Each `build:` block of a compose file, its more-indented lines with the block's own indent removed. */
function buildBlocks(yaml: string): string[] {
  return [...yaml.matchAll(/^( *)build:\n((?:\1 {2}.*\n)*)/gm)].map((m) => m[2]!.replace(new RegExp(`^${m[1]!} {2}`, "gm"), ""));
}

const read = (rel: string): string => fs.readFileSync(path.join(root, rel), "utf8");

describe("the overlay build context", () => {
  it("tracks no file under src/private/ and ignores what lands there", () => {
    // Act
    const tracked = execFileSync("git", ["ls-files", "src/private"], { cwd: root, encoding: "utf8" });
    const ignored = spawnSync("git", ["check-ignore", "src/private/perimeter.overlay.ts"], { cwd: root, encoding: "utf8" });

    // Assert
    expect(tracked).toBe("");
    expect(ignored.stdout.trim()).toBe("src/private/perimeter.overlay.ts");
  });

  it("copies the perimeter-overlay context, an empty stage by default, to src/private/ before the build", () => {
    // Arrange
    const lines = read("Dockerfile").split("\n");
    const at = (line: string): number => lines.indexOf(line);

    // Act
    const stage = at("FROM scratch AS perimeter-overlay");
    const builder = at("FROM node:22-alpine AS builder");
    const source = at("COPY . .");
    const overlay = at("COPY --from=perimeter-overlay . src/private/");
    const build = at("RUN npm run build");

    // Assert
    expect([stage, builder, source, overlay, build].every((i) => i >= 0)).toBe(true);
    expect(stage).toBeLessThan(builder);
    expect(builder).toBeLessThan(source);
    expect(source).toBeLessThan(overlay);
    expect(overlay).toBeLessThan(build);
  });

  it("labels the image with the overlay commit, `none` when the build names none", () => {
    // Arrange
    const runtime = read("Dockerfile").split("AS runtime\n")[1] ?? "";

    // Act & Assert
    expect(runtime).toContain("\nARG PERIMETER_OVERLAY_SHA\n");
    expect(runtime).toContain("\nENV PERIMETER_OVERLAY_SHA=${PERIMETER_OVERLAY_SHA:-none}\n");
    expect(runtime).toContain("\nLABEL org.skkuverse.perimeter-overlay=${PERIMETER_OVERLAY_SHA:-none}\n");
  });

  it("keeps a local overlay and the empty default out of the main context", () => {
    // Arrange
    const entries = read(".dockerignore").split("\n");

    // Act & Assert
    expect(entries).toEqual(expect.arrayContaining(["src/private", "perimeter-overlay.empty"]));
  });

  it("gives every compose build the overlay context, the empty folder by default, and the overlay commit", () => {
    // Arrange
    const blocks = buildBlocks(read("docker-compose.yml"));

    // Act
    const missing = blocks.filter(
      (block) =>
        !block.includes("additional_contexts:\n  perimeter-overlay: ${PERIMETER_OVERLAY_DIR:-./perimeter-overlay.empty}\n") ||
        !block.includes("\n  - PERIMETER_OVERLAY_SHA\n"),
    );

    // Assert
    expect(blocks).toHaveLength(2);
    expect(missing).toEqual([]);
  });

  it("holds no source in the empty default, so a build from it carries no entry", () => {
    // Act
    const folder = path.join(root, "perimeter-overlay.empty");
    const files = fs.existsSync(folder) ? fs.readdirSync(folder) : [];

    // Assert
    expect(files).toEqual(["README.md"]);
  });
});

// (An operations detail is left out of the public history.)
describe("the contract export", () => {
  it("refuses to run while src/private/ holds an overlay", () => {
    // Arrange
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "export-contracts-"));
    fs.mkdirSync(path.join(scratch, "scripts"));
    fs.copyFileSync(path.join(root, "scripts/export-contracts.js"), path.join(scratch, "scripts/export-contracts.js"));
    fs.mkdirSync(path.join(scratch, "src/private"), { recursive: true });

    try {
      // Act
      const run = spawnSync(process.execPath, ["scripts/export-contracts.js", "--check"], { cwd: scratch, encoding: "utf8" });

      // Assert
      expect(run.status).toBe(1);
      expect(run.stderr).toContain("src/private/");
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});
