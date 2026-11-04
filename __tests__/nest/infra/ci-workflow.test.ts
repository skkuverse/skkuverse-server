/**
 * CI and the local hooks run one entry point, `npm run check:ci` (scripts/check-ci.sh), so what they check cannot
 * drift apart:
 *
 *   - ci.yml runs on a pull request to main or dev and on a push to dev, one run per ref, and has one job, `ci`,
 *     that only calls the shared workflow skkuverse/.github/.github/workflows/checks.yml, pinned to a commit with its
 *     version, with `toolchain: node`, `check-cmd: "npm run check:ci"` and `public: true`. The shared workflow checks
 *     out full history (list-growth fails in CI without its base), installs with `sfw npm ci` and lints the
 *     workflows; the ruleset requires its `ci / gate`;
 *   - package.json's `check:ci` runs scripts/check-ci.sh, which stops at the first failing step and runs CI's steps
 *     in order, the mongod binary check first: mongodb-memory-server's postinstall exits 0 when its download
 *     fails, so without it a failed download surfaces later as test files that find no binary;
 *   - scripts/check-ci.sh runs the same way everywhere: no line reads CI, GITHUB_* or RUNNER_*, except the lines
 *     that open and close a log group on GitHub Actions and do nothing else.
 *
 * Patterns rather than a YAML parser: the repo avoids the dependency. The rules are tested on the mutants they exist
 * to catch, then on the real files.
 */
import fs from "fs";
import path from "path";

const root = path.join(__dirname, "../../..");
const readIfPresent = (rel: string) => (fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), "utf8") : "");

const SHARED_WORKFLOW = "skkuverse/.github/.github/workflows/checks.yml";
const CALLER_WITH = { toolchain: "node", "check-cmd": "npm run check:ci", public: "true" };

/** Two-space-indented keys under `jobs:`, each with its indented body. */
function jobBlocks(yaml: string): Map<string, string> {
  const jobs = yaml.slice(yaml.indexOf("\njobs:\n"));
  const blocks = new Map<string, string>();
  for (const m of jobs.matchAll(/^ {2}([a-z0-9-]+):\n((?: {4}.*\n|\s*\n)*)/gm)) blocks.set(m[1]!, m[2]!);
  return blocks;
}

const unquote = (value: string) => value.trim().replace(/^(["'])(.*)\1$/, "$2");

/** Why ci.yml is more than a call of the shared workflow with the server's inputs; empty when it is only that. */
export function callerProblems(yaml: string): string[] {
  const jobs = jobBlocks(yaml);
  const problems = [...jobs.keys()].filter((name) => name !== "ci").map((name) => `job ${name} besides ci`);
  const body = jobs.get("ci");
  if (body === undefined) return [...problems, "no ci job"];
  const lines = body.split("\n").filter((line) => line.trim() !== "" && !/^\s*#/.test(line));
  const keys = lines.filter((line) => /^ {4}\S/.test(line)).map((line) => /^ {4}([\w-]+):/.exec(line)?.[1] ?? line.trim());
  const uses = /^ {4}uses: (\S+)@([0-9a-f]+)(?: # (v\S+))?$/m.exec(body);
  const withEntries = Object.fromEntries(
    lines.filter((line) => /^ {6}\S/.test(line)).map((line) => {
      const [, key = line.trim(), value = ""] = /^ {6}([\w-]+):(.*)$/.exec(line) ?? [];
      return [key, unquote(value)];
    }),
  );
  if (keys.join(",") !== "uses,with") problems.push(`ci job keys: ${keys.join(", ")}`);
  if (uses?.[1] !== SHARED_WORKFLOW) problems.push(`ci calls ${uses?.[1] ?? "nothing"}`);
  if (!/^[0-9a-f]{40}$/.test(uses?.[2] ?? "")) problems.push("the shared workflow is not pinned to a 40-hex commit");
  if (!/^v\d+\.\d+\.\d+$/.test(uses?.[3] ?? "")) problems.push("the pin has no # vX.Y.Z version comment");
  if (JSON.stringify(withEntries) !== JSON.stringify(CALLER_WITH)) problems.push(`ci passes ${JSON.stringify(withEntries)}`);
  return problems;
}

const RUNNER_VARIABLE = String.raw`(?:CI|GITHUB_\w+|RUNNER_\w+)\b`;
const READS_RUNNER_VARIABLE = new RegExp(String.raw`\$\{?!?${RUNNER_VARIABLE}|-v\s+${RUNNER_VARIABLE}|printenv\s+${RUNNER_VARIABLE}`);
const LOG_GROUP_LINE = /^\s*if \[ -n "\$\{GITHUB_ACTIONS:-\}" \]; then echo "::(?:end)?group::[^"]*"; fi\s*$/;

/** `<line>: <text>` for each line of a shell script that reads where it runs, other than a log-group line. */
export function runnerBranches(script: string): string[] {
  return script.split("\n").flatMap((line, i) => {
    if (/^\s*#/.test(line) || !READS_RUNNER_VARIABLE.test(line) || LOG_GROUP_LINE.test(line)) return [];
    return [`${i + 1}: ${line.trim()}`];
  });
}

/** The `step <name> <command>` lines of a check script, in order. */
export const checkSteps = (script: string): Array<[string, string]> =>
  [...script.matchAll(/^step (\S+) (.+?)\s*$/gm)].map((m) => [m[1]!, m[2]!]);

describe("the CI entry point rules apply as specified", () => {
  const SHA = "0123456789abcdef0123456789abcdef01234567";
  const caller = (job: string[], extraJobs: string[] = []) =>
    ["name: CI", "jobs:", "  ci:", ...job, ...extraJobs, ""].join("\n");
  const CALL = [
    `    uses: ${SHARED_WORKFLOW}@${SHA} # v1.0.0`,
    "    with:",
    "      toolchain: node",
    '      check-cmd: "npm run check:ci"',
    "      public: true",
  ];

  it("passes a job that only calls the shared workflow with the server's inputs", () => {
    // Act & Assert
    expect(callerProblems(caller(CALL))).toEqual([]);
  });

  it.each([
    ["a second job", caller(CALL, ["  lint:", "    runs-on: ubuntu-latest", "    steps:", "      - run: npm run lint"])],
    ["a check command other than check:ci", caller(CALL.map((l) => l.replace("npm run check:ci", "npm test")))],
    ["an input left out", caller(CALL.filter((l) => !l.includes("public:")))],
    ["an extra input", caller([...CALL, "      check-cmd-extra: npm run knip"])],
    ["a tag instead of a commit", caller(CALL.map((l) => l.replace(`@${SHA} # v1.0.0`, "@v1")))],
    ["a commit without its version", caller(CALL.map((l) => l.replace(" # v1.0.0", "")))],
    ["another workflow", caller(CALL.map((l) => l.replace("skkuverse/.github/", "someone/.github/")))],
    ["secrets handed to the call", caller([...CALL, "    secrets: inherit"])],
    ["no job", "name: CI\njobs:\n"],
  ])("refuses %s", (_case, yaml) => {
    // Act & Assert
    expect(callerProblems(yaml)).not.toEqual([]);
  });

  it("passes the log-group lines, an export of CI and a comment that names a variable", () => {
    // Arrange
    const script = [
      "export CI=true TZ=UTC LANG=C.UTF-8",
      '  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::group::$name"; fi',
      '  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::endgroup::"; fi',
      "# GitHub Actions sets $GITHUB_ACTIONS and $CI",
    ].join("\n");

    // Act & Assert
    expect(runnerBranches(script)).toEqual([]);
  });

  it.each([
    ["a step that runs only in CI", 'if [ -n "${CI:-}" ]; then npm run knip; fi'],
    ["an early exit outside GitHub Actions", '[ -z "$GITHUB_ACTIONS" ] && exit 0'],
    ["a log-group line that also runs a command", 'if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::group::x"; npm ci; fi'],
    ["a branch on the runner's OS", 'case "$RUNNER_OS" in Linux) step lint npm run lint ;; esac'],
    ["a test of whether CI is set", "[[ -v CI ]] || step knip npm run knip"],
    ["a branch on the event", 'if [ "${GITHUB_EVENT_NAME}" = push ]; then exit 0; fi'],
    ["printenv", "printenv GITHUB_ACTIONS >/dev/null && step test npm test"],
  ])("finds %s", (_case, line) => {
    // Act & Assert
    expect(runnerBranches(line)).toHaveLength(1);
  });

  it("reads the step lines in order, and nothing else", () => {
    // Arrange
    const script = ["step() { :; }", "step typecheck npm run typecheck", "# step skipped npm run nothing", "step test npm test -- --ci  "].join("\n");

    // Act & Assert
    expect(checkSteps(script)).toEqual([
      ["typecheck", "npm run typecheck"],
      ["test", "npm test -- --ci"],
    ]);
  });
});

describe(".github/workflows/ci.yml", () => {
  const ci = readIfPresent(".github/workflows/ci.yml");

  it("only calls the shared workflow, pinned, with check-cmd npm run check:ci", () => {
    // Act & Assert
    expect(callerProblems(ci)).toEqual([]);
  });

  it("runs on a pull request to main or dev and on a push to dev, one run per ref", () => {
    // Act
    const on = /^on:\n((?: {2}.*\n|\s*\n)*)/m.exec(ci)?.[1] ?? "";

    // Assert
    expect(on.trim().split("\n").map((line) => line.trim())).toEqual([
      "pull_request:",
      "branches: [main, dev]",
      "push:",
      "branches: [dev]",
    ]);
    expect(ci).toMatch(/^concurrency:\n {2}group: ci-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: true$/m);
  });
});

describe("scripts/check-ci.sh", () => {
  const script = readIfPresent("scripts/check-ci.sh");
  const pkg = JSON.parse(readIfPresent("package.json")) as { scripts: Record<string, string> };

  it("is what npm run check:ci runs", () => {
    // Assert
    expect(pkg.scripts["check:ci"]).toBe("bash scripts/check-ci.sh");
  });

  it("stops at the first failing step and runs CI's steps in order, the mongod binary check first", () => {
    // Assert
    expect(script).toMatch(/^set -euo pipefail$/m);
    expect(checkSteps(script)).toEqual([
      ["mongod", "mongod_binary_present"],
      ["typecheck", "npm run typecheck"],
      ["build", "npm run build"],
      ["contracts", "python3 .github/contract-tools/exported/sync_contracts.py check --repo server --root ."],
      ["conventions", "python3 .github/contract-tools/exported/lint_conventions.py --root . --only frontmatter --only structure"],
      ["test", "npm test -- --ci --maxWorkers=3"],
      ["lint", "npm run lint"],
      ["knip", "npm run knip"],
    ]);
  });

  it("does not branch on where it runs", () => {
    // Assert
    expect(script).not.toBe("");
    expect(runnerBranches(script)).toEqual([]);
  });
});
