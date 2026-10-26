/**
 * The repository is public, so a workflow runs for people who are not its
 * maintainers, and GitHub gives a fork's pull request no secret:
 *
 *   - no workflow uses `pull_request_target`, which runs a fork's PR with the
 *     base repository's secrets and a write token;
 *   - every workflow sets `permissions:` at the top, read-only or empty, so a
 *     job gets write access only where it names it;
 *   - ci.yml reads no secret and clones no other repository: the contract and
 *     conventions checks run the copies vendored under .github/contract-tools/,
 *     hash-locked in .contracts.lock.json;
 *   - claude.yml starts only for a comment or review from an OWNER, MEMBER or
 *     COLLABORATOR, because the job holds CLAUDE_CODE_OAUTH_TOKEN;
 *   - contracts-sync.yml, the one workflow that holds the umbrella key, runs
 *     on a schedule or by hand, on the default branch, never for a pull
 *     request, and its PR body links no private repository.
 *
 * Patterns rather than a YAML parser: the repo avoids the dependency.
 */
import fs from "fs";
import path from "path";

const root = path.join(__dirname, "../../..");
const WORKFLOWS = ".github/workflows";
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const files = fs.readdirSync(path.join(root, WORKFLOWS)).filter((f) => /\.ya?ml$/.test(f));
const workflow = (name: string) => read(`${WORKFLOWS}/${name}`);

/** The top-level `on:` block. */
const triggers = (yaml: string) => /^on:\n((?: {2}.*\n|\s*\n)*)/m.exec(yaml)?.[1] ?? "";
const triggerNames = (yaml: string) => [...triggers(yaml).matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);

/** The top-level `permissions:` value, inline or as a block. */
function topLevelPermissions(yaml: string): string | undefined {
  const m = /^permissions:(.*)\n((?: {2}.*\n)*)/m.exec(yaml);
  return m === null ? undefined : (m[1]!.trim() || m[2]!.trim());
}

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
});

describe("ci.yml", () => {
  const ci = workflow("ci.yml");

  it("reads no secret and clones no other repository", () => {
    // Assert
    expect(ci).not.toMatch(/secrets\./);
    expect(ci).not.toMatch(/git clone|git@github\.com/);
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
  const jobIf = /^ {2}claude:\n(?: {4}#.*\n)* {4}if: \|\n((?: {6}.*\n)+)/m.exec(claude)?.[1] ?? "";

  it("starts the job only for an OWNER, MEMBER or COLLABORATOR, for every event it listens to", () => {
    // Act
    const events = triggerNames(claude);
    const gated = events.filter((event) =>
      jobIf
        .split("\n")
        .some(
          (line) =>
            line.includes(`github.event_name == '${event}'`) &&
            /contains\(fromJSON\('\["OWNER","MEMBER","COLLABORATOR"\]'\), github\.event\.(comment|review)\.author_association\)/.test(line),
        ),
    );

    // Assert
    expect(events.length).toBeGreaterThan(0);
    expect(gated).toEqual(events);
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

  it("links no private repository in the pull request it opens", () => {
    // Assert
    expect(sync).not.toMatch(/https:\/\/github\.com\//);
  });
});
