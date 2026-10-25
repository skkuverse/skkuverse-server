/**
 * The test job of ci.yml, pinned by pattern (the repo avoids a YAML parser dependency):
 *
 *   - it checks out full history, or list-growth has no base to compare the architecture lists with
 *     (PR 237 F2);
 *   - it restores the mongod binary cache before `npm ci` and checks the binary after it, or a run
 *     depends on the binary download, whose failure `npm ci` does not report (PR 238 F1).
 *
 * Moved from deploy-workflow.test.ts, which also held these against the deleted deploy.yml.
 */
import fs from "fs";
import path from "path";

const ci = fs.readFileSync(path.join(__dirname, "../../../.github/workflows/ci.yml"), "utf8");

/** Two-space-indented keys under `jobs:`, each with its indented body. */
function jobBlocks(yaml: string): Map<string, string> {
  const jobs = yaml.slice(yaml.indexOf("\njobs:\n"));
  const blocks = new Map<string, string>();
  for (const m of jobs.matchAll(/^ {2}([a-z0-9-]+):\n((?: {4}.*\n|\s*\n)*)/gm)) blocks.set(m[1]!, m[2]!);
  return blocks;
}

/** A job's steps, each without its comment lines. */
const steps = (body: string) =>
  body
    .slice(body.indexOf("    steps:\n") + "    steps:\n".length)
    .split(/^(?= {6}- )/m)
    .map((step) => step.replace(/^ *#.*\n/gm, ""))
    .filter((step) => step.trim() !== "");

const testJob = jobBlocks(ci).get("test")!;

describe("ci.yml — the test job", () => {
  it("runs npm test on pull requests", () => {
    // Assert
    expect(ci).toMatch(/^ {2}pull_request:$/m);
    expect(testJob).toMatch(/^ {6}- run: npm test$/m);
  });

  it("checks out full history, so list-growth has its base", () => {
    // Assert
    expect(testJob).toMatch(/uses: actions\/checkout@\S+.*\n {8}with:\n(?: {10}#.*\n)* {10}fetch-depth: 0$/m);
  });

  it("restores the mongod binary cache before npm ci and checks the binary after it", () => {
    // Act
    const order = steps(testJob)
      .map((step) => /name: (mongod [\w ]+)|uses: (actions\/cache)@|run: (npm ci)$/m.exec(step)?.slice(1).find(Boolean))
      .filter(Boolean);
    const env = /^ {4}env:\n((?: {6}.*\n)+)/m.exec(testJob)?.[1];

    // Assert
    expect(env).toBe("      MONGOMS_DOWNLOAD_DIR: /home/runner/.cache/mongodb-binaries\n");
    expect(order).toEqual(["mongod version", "actions/cache", "npm ci", "mongod binary present"]);
    expect(testJob).toContain("path: /home/runner/.cache/mongodb-binaries");
  });
});
