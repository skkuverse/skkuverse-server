/**
 * The repository is public, so a workflow runs for people who are not its
 * maintainers, and its logs are public too:
 *
 *   - no workflow uses `pull_request_target`, which runs a fork's PR with the
 *     base repository's secrets and a write token;
 *   - every workflow sets `permissions:` at the top, read-only or empty, so a
 *     job gets write access only where it names it, and only contracts-sync.yml
 *     names `contents: write`;
 *   - only claude.yml and contracts-sync.yml read a secret, in any syntax, and
 *     only contracts-sync.yml uses an environment (`contracts-sync`, which
 *     holds its secrets);
 *   - no `run:` script interpolates an expression: an event field, a branch
 *     name or a step output reaches a script only through `env:`, so text an
 *     outsider wrote is never pasted into a shell command;
 *   - nothing under .github/ names a repository of the maintainer's personal
 *     account, where the private repositories live;
 *   - ci.yml reads no secret and clones no other repository: the contract and
 *     conventions checks run the copies vendored under .github/contract-tools/,
 *     hash-locked in .contracts.lock.json;
 *   - claude.yml starts only for a comment or review from an OWNER, MEMBER or
 *     COLLABORATOR: every disjunct of its gate checks `author_association`, and
 *     every other job needs the gated one;
 *   - contracts-sync.yml runs on a schedule or by hand, on the default branch,
 *     never for a pull request; it checks that its secrets are set before any
 *     other step, and its PR body links no private repository.
 *
 * Patterns rather than a YAML parser: the repo has no parser dependency. The
 * rules are tested on the mutants they exist to catch, then on the real files.
 */
import fs from "fs";
import path from "path";

const root = path.join(__dirname, "../../..");
const WORKFLOWS = ".github/workflows";
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const files = fs.readdirSync(path.join(root, WORKFLOWS)).filter((f) => /\.ya?ml$/.test(f));
const workflow = (name: string) => read(`${WORKFLOWS}/${name}`);

const SECRET_HOLDERS = ["claude.yml", "contracts-sync.yml"];
const GATE = /^contains\(fromJSON\('\["OWNER","MEMBER","COLLABORATOR"\]'\), github\.event\.(comment|review)\.author_association\)$/;

/** The top-level `on:` block. */
const triggers = (yaml: string) => /^on:\n((?: {2}.*\n|\s*\n)*)/m.exec(yaml)?.[1] ?? "";
const triggerNames = (yaml: string) => [...triggers(yaml).matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);

/** The top-level `permissions:` value, inline or as a block. */
function topLevelPermissions(yaml: string): string | undefined {
  const m = /^permissions:(.*)\n((?: {2}.*\n)*)/m.exec(yaml);
  return m === null ? undefined : (m[1]!.trim() || m[2]!.trim());
}

/** The lines YAML reads as keys and values: full-line comments dropped. */
const yamlLines = (yaml: string) => yaml.split("\n").filter((line) => !/^\s*#/.test(line));

/** A secret read in any syntax: `secrets.X`, `secrets['X']`, or the whole context. */
export const readsSecret = (yaml: string) => /\bsecrets\s*[.[]|\(\s*secrets\s*\)/.test(yaml);

export const usesEnvironment = (yaml: string) => yamlLines(yaml).some((line) => /^\s*environment:/.test(line));

export const grantsWrite = (yaml: string) => yamlLines(yaml).some((line) => /^\s*contents:\s*write\b|\bwrite-all\b/.test(line));

/** `<line>: <text>` for each line of a `run:` script that holds a `${{ }}` expression. */
export function interpolatedRuns(yaml: string): string[] {
  const lines = yaml.split("\n");
  const found: string[] = [];
  lines.forEach((line, i) => {
    const m = /^(\s*(?:-\s+)?)run:(.*)$/.exec(line);
    if (m === null) return;
    const keyIndent = m[1]!.length;
    const script = [{ n: i, text: m[2]! }];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]!;
      if (next.trim() !== "" && next.length - next.trimStart().length <= keyIndent) break;
      script.push({ n: j, text: next });
    }
    for (const { n, text } of script) if (text.includes("${{")) found.push(`${n + 1}: ${text.trim()}`);
  });
  return found;
}

export const namesPersonalRepository = (text: string) => /github\.com[:/]spencer0124\//.test(text);

/** Two-space-indented keys under `jobs:`, each with its body. */
function jobBlocks(yaml: string): Map<string, string> {
  const jobs = yaml.slice(yaml.indexOf("\njobs:\n"));
  const blocks = new Map<string, string>();
  for (const m of jobs.matchAll(/^ {2}([A-Za-z0-9_-]+):\n((?: {4}.*\n|\s*\n)*)/gm)) blocks.set(m[1]!, m[2]!);
  return blocks;
}

/** A job's `if:`, inline or as a block scalar, without a `${{ }}` wrapper. */
function jobIf(body: string): string | undefined {
  const m = /^ {4}if:[ \t]*(.*)\n((?: {6}.*\n)*)/m.exec(body);
  if (m === null) return undefined;
  const text = /^[|>]/.test(m[1]!) ? m[2]!.replace(/\n/g, " ") : m[1]!;
  return text.trim().replace(/^\$\{\{([\s\S]*)\}\}$/, "$1").trim();
}

function jobNeeds(body: string): string[] {
  const value = /^ {4}needs:[ \t]*(.*)$/m.exec(body)?.[1]?.trim() ?? "";
  return value.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Split an expression on a top-level operator, outside parentheses and '…' strings. */
function splitTop(expr: string, op: "||" | "&&"): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === "'") quoted = !quoted;
    else if (!quoted && c === "(") depth++;
    else if (!quoted && c === ")") depth--;
    else if (!quoted && depth === 0 && expr.startsWith(op, i)) {
      parts.push(expr.slice(start, i));
      start = i + op.length;
      i += op.length - 1;
    }
  }
  parts.push(expr.slice(start));
  return parts.map((p) => p.trim());
}

/** The expression without parentheses that wrap all of it. */
function unwrap(expr: string): string {
  let e = expr.trim();
  while (e.startsWith("(") && e.endsWith(")")) {
    let depth = 0;
    let wrapsAll = true;
    for (let i = 0; i < e.length - 1; i++) {
      if (e[i] === "(") depth++;
      else if (e[i] === ")") depth--;
      if (depth === 0) {
        wrapsAll = false;
        break;
      }
    }
    if (!wrapsAll) break;
    e = e.slice(1, -1).trim();
  }
  return e;
}

const conjuncts = (disjunct: string) => splitTop(unwrap(disjunct), "&&").map(unwrap);

/** The disjuncts of a condition that do not require the author to be an OWNER, MEMBER or COLLABORATOR. */
export const ungatedDisjuncts = (condition: string) =>
  splitTop(unwrap(condition), "||").filter((d) => !conjuncts(d).some((c) => GATE.test(c)));

/** The jobs of a workflow that can start for someone who is not a maintainer. */
export function ungatedJobs(yaml: string): string[] {
  const jobs = jobBlocks(yaml);
  const gated = new Set([...jobs].filter(([, body]) => {
    const condition = jobIf(body);
    return condition !== undefined && ungatedDisjuncts(condition).length === 0;
  }).map(([name]) => name));
  return [...jobs].filter(([name, body]) => {
    if (gated.has(name)) return false;
    // A job that needs a skipped job is skipped too, unless its condition calls a status function.
    const condition = jobIf(body) ?? "";
    return !jobNeeds(body).some((need) => gated.has(need)) || /\b(always|failure|cancelled)\s*\(/.test(condition);
  }).map(([name]) => name);
}

/** The events a workflow listens to that no gated condition names. */
export function eventsWithoutGate(yaml: string): string[] {
  const named = [...jobBlocks(yaml).values()]
    .flatMap((body) => {
      const condition = jobIf(body);
      return condition === undefined ? [] : splitTop(unwrap(condition), "||");
    })
    .filter((d) => conjuncts(d).some((c) => GATE.test(c)))
    .flatMap((d) => conjuncts(d).map((c) => /^github\.event_name == '([a-z_]+)'$/.exec(c)?.[1]).filter(Boolean));
  return triggerNames(yaml).filter((event) => !named.includes(event));
}

const GATED_IF = (event: string, field: string) =>
  `(github.event_name == '${event}' && contains(github.event.${field}.body, '@claude') && contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.${field}.author_association))`;

describe("the public-workflow rules apply as specified", () => {
  // M1: a new workflow a fork's pull request starts, holding what only contracts-sync.yml may hold.
  const forkWorkflow = [
    "name: Mutant",
    "on:",
    "  pull_request:",
    "permissions:",
    "  contents: read",
    "jobs:",
    "  steal:",
    "    runs-on: ubuntu-latest",
    "    environment: contracts-sync",
    "    permissions:",
    "      contents: write",
    "    steps:",
    "      - run: |",
    "          echo \"${{ secrets.FLEET_READ_TOKEN }}\"",
    "          echo \"${{ github.event.pull_request.title }}\"",
    "",
  ].join("\n");

  it("refuses a pull-request workflow that reads a secret, uses the environment, writes contents or interpolates the title", () => {
    // Act & Assert
    expect(readsSecret(forkWorkflow)).toBe(true);
    expect(usesEnvironment(forkWorkflow)).toBe(true);
    expect(grantsWrite(forkWorkflow)).toBe(true);
    expect(interpolatedRuns(forkWorkflow)).toEqual([
      '14: echo "${{ secrets.FLEET_READ_TOKEN }}"',
      '15: echo "${{ github.event.pull_request.title }}"',
    ]);
  });

  it.each([
    ["dot syntax", "token: ${{ secrets.X }}"],
    ["bracket syntax", "token: ${{ secrets['X'] }}"],
    ["bracket syntax with spaces", "token: ${{ secrets [ \"X\" ] }}"],
    ["the whole context", "all: ${{ toJSON(secrets) }}"],
  ])("finds a secret read in %s", (_case, line) => {
    // Act & Assert
    expect(readsSecret(line)).toBe(true);
  });

  it("finds no secret read in prose about secrets", () => {
    // Act & Assert
    expect(readsSecret("# its secrets live in an environment; no secret, secrets, or secrets: here")).toBe(false);
  });

  it.each([
    ["a step output on one line", "      - run: echo ${{ steps.mongod.outputs.version }}"],
    ["a step output in a block", "      - name: x\n        run: |\n          ls \"$DIR\"\n          ls x-\"${{ steps.mongod.outputs.version }}\""],
    ["the head branch", "        run: git checkout ${{ github.head_ref }}"],
  ])("finds an expression in a run script: %s", (_case, yaml) => {
    // Act & Assert
    expect(interpolatedRuns(yaml)).toHaveLength(1);
  });

  it("allows an expression in env: and with:, beside a run script that reads it", () => {
    // Arrange
    const yaml = [
      "      - name: x",
      "        env:",
      "          VERSION: ${{ steps.mongod.outputs.version }}",
      "        run: |",
      "          echo \"$VERSION\"",
      "      - uses: a/b@0123456789abcdef0123456789abcdef01234567 # v1",
      "        with:",
      "          token: ${{ github.token }}",
    ].join("\n");

    // Act & Assert
    expect(interpolatedRuns(yaml)).toEqual([]);
  });

  it.each([
    ["an ssh clone URL", "git clone git@github.com:spencer0124/skkuverse.git"],
    ["an https URL", "see https://github.com/spencer0124/example-private/blob/main/x.md"],
  ])("finds %s of a personal-account repository", (_case, text) => {
    // Act & Assert
    expect(namesPersonalRepository(text)).toBe(true);
  });

  it("finds an extra disjunct without the author_association check, even on a gated line", () => {
    // Arrange
    // M2: one gated line, one ungated disjunct.
    const condition = `${GATED_IF("issue_comment", "comment")} || (github.event_name == 'issues')`;

    // Act & Assert
    expect(ungatedDisjuncts(condition)).toEqual(["(github.event_name == 'issues')"]);
  });

  it("finds a check that is not a conjunct of its disjunct", () => {
    // Arrange
    const gate = `contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.comment.author_association)`;

    // Act & Assert
    expect(ungatedDisjuncts(`github.event_name == 'issue_comment' && (${gate} || true)`)).toHaveLength(1);
    expect(ungatedDisjuncts(`github.event_name == 'issue_comment' && !${gate}`)).toHaveLength(1);
    expect(ungatedDisjuncts(`(github.event_name == 'issue_comment' || github.event_name == 'issues') && ${gate}`)).toEqual([]);
  });

  it("finds a job that runs whether or not the gated job ran", () => {
    // Arrange
    const yaml = (secondIf: string) =>
      [
        "on:",
        "  issue_comment:",
        "jobs:",
        "  mode:",
        "    if: |",
        `      ${GATED_IF("issue_comment", "comment")}`,
        "    runs-on: ubuntu-latest",
        "  run:",
        "    needs: mode",
        `    if: ${secondIf}`,
        "    runs-on: ubuntu-latest",
        "",
      ].join("\n");

    // Act & Assert
    expect(ungatedJobs(yaml("needs.mode.outputs.mode == 'read'"))).toEqual([]);
    expect(ungatedJobs(yaml("always() && needs.mode.outputs.mode == 'read'"))).toEqual(["run"]);
    expect(ungatedJobs(yaml("!cancelled()"))).toEqual(["run"]);
    expect(ungatedJobs(yaml("github.event_name == 'issue_comment'").replace("    needs: mode\n", ""))).toEqual(["run"]);
  });
});

describe(".github/workflows on a public repository", () => {
  it("never use pull_request_target", () => {
    // Act
    const users = files.filter((f) => /pull_request_target/.test(workflow(f)));

    // Assert
    expect(files.length).toBeGreaterThan(0);
    expect(users).toEqual([]);
  });

  it("set a read-only or empty default for the token at the top of each workflow", () => {
    // Act
    const defaults = Object.fromEntries(files.map((f) => [f, topLevelPermissions(workflow(f))]));

    // Assert
    for (const f of files) expect([f, defaults[f]]).toEqual([f, expect.stringMatching(/^(\{\}|contents: read)$/)]);
  });

  it("read secrets only in claude.yml and contracts-sync.yml", () => {
    // Act
    const readers = files.filter((f) => readsSecret(workflow(f)));

    // Assert
    expect(readers.filter((f) => !SECRET_HOLDERS.includes(f))).toEqual([]);
  });

  it("use an environment only in contracts-sync.yml", () => {
    // Act
    const users = files.filter((f) => usesEnvironment(workflow(f)));

    // Assert
    expect(users).toEqual(["contracts-sync.yml"]);
  });

  it("grant contents: write only in contracts-sync.yml", () => {
    // Act
    const writers = files.filter((f) => grantsWrite(workflow(f)));

    // Assert
    expect(writers).toEqual(["contracts-sync.yml"]);
  });

  it("pass expressions to run scripts only through env:", () => {
    // Act
    const found = files.flatMap((f) => interpolatedRuns(workflow(f)).map((hit) => `${f}:${hit}`));

    // Assert
    expect(found).toEqual([]);
  });
});

describe(".github/", () => {
  it("names no repository of the maintainer's personal account", () => {
    // Arrange
    const walk = (dir: string): string[] =>
      fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
      );

    // Act
    const naming = walk(".github").filter((f) => namesPersonalRepository(read(f)));

    // Assert
    expect(naming).toEqual([]);
  });
});

describe("ci.yml", () => {
  const ci = workflow("ci.yml");

  it("reads no secret and clones no other repository", () => {
    // Assert
    expect(readsSecret(ci)).toBe(false);
    expect(ci).not.toMatch(/git clone|git@github\.com/);
  });

  it("leaves no token in .git/config for the code it tests", () => {
    // Assert
    expect(ci).toMatch(/uses: actions\/checkout@\S+.*\n {8}with:\n(?: {10}.*\n)* {10}persist-credentials: false$/m);
  });

  it("runs the contract and conventions checks from the vendored copies", () => {
    // Assert
    expect(ci).toMatch(/^ {8}run: python3 \.github\/contract-tools\/exported\/sync_contracts\.py check --repo server --root \.$/m);
    expect(ci).toMatch(/python3 \.github\/contract-tools\/exported\/lint_conventions\.py --root \./);
  });
});

describe("the vendored contract tools", () => {
  it("are hash-locked in .contracts.lock.json at the paths ci.yml runs", () => {
    // Arrange
    const lock = JSON.parse(read(".contracts.lock.json")) as { contracts: Record<string, { path: string }> };

    // Act
    const paths = Object.values(lock.contracts).map((c) => c.path);

    // Assert
    expect(paths).toEqual(
      expect.arrayContaining([
        ".github/contract-tools/exported/sync_contracts.py",
        ".github/contract-tools/exported/lint_conventions.py",
        ".github/contract-tools/contracts/manifest.json",
      ]),
    );
  });
});

describe("claude.yml", () => {
  const claude = workflow("claude.yml");

  it("starts every job only for an OWNER, MEMBER or COLLABORATOR, for every event it listens to", () => {
    // Act
    const jobs = [...jobBlocks(claude).keys()];

    // Assert
    expect(triggerNames(claude).length).toBeGreaterThan(0);
    expect(jobs.length).toBeGreaterThan(0);
    expect(ungatedJobs(claude)).toEqual([]);
    expect(eventsWithoutGate(claude)).toEqual([]);
  });

  it("gives read mode the job's own token, without id-token, and scrubs subprocess environments", () => {
    // Arrange
    const jobs = jobBlocks(claude);
    const readJob = [...jobs.values()].find((body) => /needs\.mode\.outputs\.mode == 'read'/.test(body)) ?? "";

    // Assert
    expect(readJob).toMatch(/^ {10}github_token: \$\{\{ github\.token \}\}$/m);
    expect(readJob).not.toMatch(/id-token:/);
    expect(readJob).toMatch(/^ {6}CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1"$/m);
    expect(readJob).toMatch(/\$\{\{ env\.CLAUDE_READ_ONLY_LOCK \}\}/);
    expect(readJob).toMatch(/\$\{\{ env\.CLAUDE_GIT_LOCK \}\}/);
  });

  it("keeps Claude out of .git/ and away from the git forms that read or write other files", () => {
    // Act
    const lock = /^ {2}CLAUDE_GIT_LOCK: >-\n {4}--disallowedTools "([^"]*)"$/m.exec(claude)?.[1]?.split(",") ?? [];

    // Assert
    expect(lock).toEqual(expect.arrayContaining(["Read(.git/**)", "Bash(*--output*)", "Bash(*--no-index*)"]));
  });

  // WHY: GitHub runs a review event on a fork's pull request without secrets, so the job could only fail there;
  // on a fork's pull request a maintainer asks with a top-level comment (docs/cicd-and-branch-protection.md).
  it("skips a review or a review comment on a fork's pull request", () => {
    // Arrange
    const gate = jobIf(jobBlocks(claude).get("mode") ?? "") ?? "";

    // Act
    const reviewDisjuncts = splitTop(unwrap(gate), "||").filter((d) => /github\.event_name == 'pull_request_review(?:_comment)?'/.test(d));

    // Assert
    expect(reviewDisjuncts).toHaveLength(2);
    for (const disjunct of reviewDisjuncts) expect(conjuncts(disjunct)).toContain("!github.event.pull_request.head.repo.fork");
  });
});

describe("contracts-sync.yml", () => {
  const sync = workflow("contracts-sync.yml");

  it("runs on a schedule or by hand, never for a pull request", () => {
    // Assert
    expect(triggerNames(sync)).toEqual(["schedule", "workflow_dispatch"]);
  });

  it("keeps its secrets in an environment, so no other workflow can read them", () => {
    // Assert
    expect(sync).toMatch(/^ {4}environment: contracts-sync$/m);
  });

  it("checks that every secret it reads is set before any other step", () => {
    // Arrange
    const names = [...new Set([...sync.matchAll(/\bsecrets\.([A-Z0-9_]+)/g)].map((m) => m[1]))];
    const firstStep = /^ {4}steps:\n((?: *#.*\n)*(?: {6}- [\s\S]*?))(?=^ {6}- )/m.exec(sync)?.[1] ?? "";

    // Act
    const loop = /for name in ([A-Z0-9_ ]+); do/.exec(firstStep)?.[1]?.split(" ") ?? [];

    // Assert
    expect(names.length).toBeGreaterThan(0);
    expect(loop.sort()).toEqual([...names].sort());
    expect(firstStep).toMatch(/exit 1/);
  });

  it("links no private repository in the pull request it opens", () => {
    // Assert
    expect(sync).not.toMatch(/https:\/\/github\.com\//);
  });
});
