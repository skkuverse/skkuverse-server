/**
 * How the build carries the perimeter overlay (ADR 0023, D4): the build empties dist/ before it compiles, so an
 * entry left by an earlier build (a removed overlay, a stale private one) can never load; knip names no overlay
 * entry, which a public checkout does not hold; and the package is private, so no publish can ship a build that
 * carries a production overlay.
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

  // WHY: the overlay compiles only at src/private/, which git ignores and knip never reads; an entry there or in the
  // retired src/perimeter/current/ would name a file a public checkout does not hold.
  it("names no overlay entry for knip", () => {
    // Act & Assert
    expect(knip.entry.filter((entry) => /^src\/(?:private|perimeter\/current)\//.test(entry))).toEqual([]);
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

  it("copies the perimeter-overlay context to src/private/ before the build", () => {
    // Arrange
    const lines = read("Dockerfile").split("\n");
    const at = (line: string): number => lines.indexOf(line);

    // Act
    const builder = at("FROM node:26-alpine AS builder");
    const source = at("COPY . .");
    const overlay = at("COPY --from=perimeter-overlay . src/private/");
    const build = at("RUN npm run build");

    // Assert
    expect([builder, source, overlay, build].every((i) => i >= 0)).toBe(true);
    expect(builder).toBeLessThan(source);
    expect(source).toBeLessThan(overlay);
    expect(overlay).toBeLessThan(build);
  });

  // WHY: with a stage of that name standing in, a build without the context could take a cached overlay layer
  // and still label the image `none`; without one, it fails at the copy.
  it("declares no stage the perimeter-overlay context could fall back to", () => {
    // Act
    const stages = [...read("Dockerfile").matchAll(/^FROM\s.*\bAS\s+(\S+)\s*$/gim)].map((m) => m[1]!.toLowerCase());

    // Assert
    expect(stages).toEqual(["builder", "runtime"]);
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

// WHY: after a deploy, the boot line is where an operator reads which overlay commit the running image carries.
describe("the boot lines", () => {
  it("name the overlay build in both roles' boot events", () => {
    // Arrange
    const main = read("src/main.ts");

    // Act
    const fieldsByEvent = new Map(
      [...main.matchAll(/logger\.info\(\s*\{([^}]*)\}/g)].map((m) => [/event: "([^"]+)"/.exec(m[1]!)?.[1], m[1]!] as const),
    );

    // Assert
    for (const event of ["app.poller_mode", "app.started"]) {
      expect(fieldsByEvent.get(event)).toContain("overlayBuild: config.perimeter.overlayBuild");
    }
  });
});
