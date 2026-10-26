#!/usr/bin/env node
/**
 * The production topology on this machine (`docker-compose.local-verify.yml`), built with the perimeter overlay as a
 * deploy builds it (docs/decisions/0023-perimeter-ports.md, D4). Production runs PERIMETER_MODE=overlay, and an image
 * without the overlay's entry refuses to boot, so `up` refuses to start without it.
 *
 * Usage:
 *   npm run verify:serve        # up: build and start, with the overlay from PERIMETER_OVERLAY_DIR or the sibling
 *                               #     companion checkout, ../private-companion-repository/server-overlay/src
 *   npm run verify:serve:down   # down
 *
 * The image is labelled `local-<short companion commit>`, with `-dirty` when that checkout has changes.
 */
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync, spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const COMPOSE = ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.local-verify.yml"];
const COMMANDS = { up: ["up", "-d", "--build"], down: ["down"] };
const SIBLING_OVERLAY = path.join(ROOT, "..", "private-companion-repository", "server-overlay", "src");

function fail(message) {
  console.error(`verify-serve: ${message}`);
  process.exit(1);
}

function companionBuild(overlayDir) {
  const git = (...args) => execFileSync("git", ["-C", overlayDir, ...args], { encoding: "utf8" }).trim();
  let sha;
  let dirty;
  try {
    sha = git("rev-parse", "--short", "HEAD");
    dirty = git("status", "--porcelain") !== "";
  } catch {
    fail(`${overlayDir} is not in a git checkout, so the image could not name its overlay commit`);
  }
  return `local-${sha}${dirty ? "-dirty" : ""}`;
}

function overlayEnv() {
  const overlayDir = path.resolve(process.env.PERIMETER_OVERLAY_DIR || SIBLING_OVERLAY);
  if (!fs.existsSync(path.join(overlayDir, "perimeter.overlay.ts"))) {
    fail(`no perimeter.overlay.ts in ${overlayDir}: set PERIMETER_OVERLAY_DIR to the companion's server-overlay/src`);
  }
  return { PERIMETER_OVERLAY_DIR: overlayDir, PERIMETER_OVERLAY_SHA: companionBuild(overlayDir) };
}

const command = process.argv[2];
if (!Object.hasOwn(COMMANDS, command)) fail("usage: verify-serve.js up|down");
const env = command === "up" ? { ...process.env, ...overlayEnv() } : process.env;
const run = spawnSync("docker", [...COMPOSE, ...COMMANDS[command]], { cwd: ROOT, env, stdio: "inherit" });
process.exit(run.status ?? 1);
