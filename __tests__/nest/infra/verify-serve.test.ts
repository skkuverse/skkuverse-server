/**
 * `npm run verify:serve` builds the production topology with the perimeter overlay, as a deploy does (ADR 0023, D4):
 * it takes the overlay folder only from PERIMETER_OVERLAY_DIR, refuses to start without it or without the overlay's
 * entry there, and labels the image with the companion commit, marked dirty when that checkout has
 * changes. A stub `docker` on PATH records what compose would run.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.join(__dirname, "../../..");
const SCRIPT = path.join(root, "scripts/verify-serve.js");

interface Run {
  status: number | null;
  stderr: string;
  docker: string | null;
}

/** Runs the script with a recording `docker` first on PATH; `docker` is null when compose never ran. */
function runVerifyServe(args: string[], env: Record<string, string>): Run {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "verify-serve-bin-"));
  const record = path.join(bin, "docker.log");
  fs.writeFileSync(path.join(bin, "docker"), `#!/bin/sh\nprintf '%s|%s|%s\\n' "$PERIMETER_OVERLAY_DIR" "$PERIMETER_OVERLAY_SHA" "$*" > "${record}"\n`, { mode: 0o755 });
  try {
    // WHY: a shell that exports the overlay variables must not leak them into the case under test.
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("PERIMETER_OVERLAY_")));
    const run = spawnSync("node", [SCRIPT, ...args], { cwd: root, encoding: "utf8", env: { ...inherited, PATH: `${bin}:${process.env.PATH}`, ...env } });
    return { status: run.status, stderr: run.stderr, docker: fs.existsSync(record) ? fs.readFileSync(record, "utf8").trim() : null };
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
  }
}

/** A companion checkout whose overlay folder holds an entry, committed once. */
function companionWithEntry(): { repo: string; overlay: string; sha: string } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "verify-serve-companion-"));
  const overlay = path.join(repo, "server-overlay/src");
  fs.mkdirSync(overlay, { recursive: true });
  fs.writeFileSync(path.join(overlay, "perimeter.overlay.ts"), "export const portsVersion = 1;\n");
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  git("init", "-q");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "overlay");
  return { repo, overlay, sha: git("rev-parse", "--short", "HEAD") };
}

describe("npm run verify:serve", () => {
  it("runs the script for both directions", () => {
    // Arrange
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };

    // Act & Assert
    expect([pkg.scripts["verify:serve"], pkg.scripts["verify:serve:down"]]).toEqual(["node scripts/verify-serve.js up", "node scripts/verify-serve.js down"]);
  });

  it("refuses to start when PERIMETER_OVERLAY_DIR is unset, naming the variable, and runs no compose", () => {
    // Act
    const run = runVerifyServe(["up"], {});

    // Assert
    // WHY: no default folder, so a checkout beside some other overlay is never built by accident.
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("PERIMETER_OVERLAY_DIR is not set");
    expect(run.docker).toBeNull();
  });

  it("refuses to start without the overlay entry, naming the folder, and runs no compose", () => {
    // Arrange
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "verify-serve-empty-"));

    try {
      // Act
      const run = runVerifyServe(["up"], { PERIMETER_OVERLAY_DIR: empty });

      // Assert
      expect(run.status).toBe(1);
      expect(run.stderr).toContain(`no perimeter.overlay.ts in ${empty}`);
      expect(run.docker).toBeNull();
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it("builds with the overlay folder, labelled with the companion commit and marked dirty when that checkout changed", () => {
    // Arrange
    const { repo, overlay, sha } = companionWithEntry();

    try {
      // Act
      const clean = runVerifyServe(["up"], { PERIMETER_OVERLAY_DIR: overlay });
      fs.appendFileSync(path.join(overlay, "perimeter.overlay.ts"), "// edited\n");
      const dirty = runVerifyServe(["up"], { PERIMETER_OVERLAY_DIR: overlay });

      // Assert
      const compose = "compose -f docker-compose.yml -f docker-compose.local-verify.yml up -d --build";
      expect([clean.status, clean.docker]).toEqual([0, `${overlay}|local-${sha}|${compose}`]);
      expect([dirty.status, dirty.docker]).toEqual([0, `${overlay}|local-${sha}-dirty|${compose}`]);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("takes the topology down without asking for the overlay", () => {
    // Act
    const run = runVerifyServe(["down"], { PERIMETER_OVERLAY_DIR: "/nonexistent" });

    // Assert
    expect([run.status, run.docker]).toEqual([0, "/nonexistent||compose -f docker-compose.yml -f docker-compose.local-verify.yml down"]);
  });
});
