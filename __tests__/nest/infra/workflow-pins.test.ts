/**
 * Every external action a workflow runs is pinned to a commit, and Dependabot
 * keeps the pins current (PR 234 F13):
 *
 *   - each `uses:` in `.github/workflows/*.yml` is a local `./…` workflow or
 *     `<owner>/<repo>[/<path>]@<40 hex>` followed by `# v<version>`, so a tag
 *     moved upstream cannot change what runs, and a reader still sees which
 *     release it is;
 *   - `.github/dependabot.yml` updates the `github-actions` pins monthly, as one
 *     grouped pull request into `dev`, and takes npm security updates only,
 *     which GitHub opens against `main` (docs/cicd-and-branch-protection.md,
 *     "Dependabot security updates").
 *
 *   - a `docker://` step names its image as `@sha256:<64 hex>` followed by
 *     `# v<version>`, and an action whose action.yaml runs its image by tag
 *     (`RUNS_IMAGE_BY_TAG`) is not used: its commit pin would leave the image
 *     it executes unpinned. Dependabot skips `docker://` steps, so a bump
 *     changes the digest and the version comment together;
 *   - the two workflow linters that `ci.yml` downloads (`workflow-lint`) are
 *     pinned the same way: an exact version and the sha256 of its release
 *     archive, which the install script checks before it unpacks the archive.
 *     Dependabot does not see a download, so the test is what keeps a floating
 *     version out.
 *
 * Patterns rather than a YAML parser: the repo avoids the dependency.
 */
import fs from "fs";
import path from "path";

const root = path.join(__dirname, "../../..");
const WORKFLOWS = ".github/workflows";
const PINNED = /^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40} # v\d+(?:\.\d+)*$/;
const PINNED_IMAGE = /^docker:\/\/[\w.-]+(?:\/[\w.-]+)*@sha256:[0-9a-f]{64} # v\d+(?:\.\d+)*$/;

/** Actions whose action.yaml runs a container image by tag, so the commit pin on the action leaves the image unpinned. */
const RUNS_IMAGE_BY_TAG = ["ossf/scorecard-action"];

/**
 * `<line>: <uses value>` for each `uses:` that is neither local, nor pinned to a SHA with its version, nor a
 * `docker://` image pinned to a digest with its version, and for each action that runs its own image by tag.
 */
export function unpinnedUses(yaml: string): string[] {
  return yaml.split("\n").flatMap((line, i) => {
    const value = /^\s*(?:-\s+)?uses:\s*(.*?)\s*$/.exec(line)?.[1];
    if (value === undefined || value.startsWith("./") || PINNED_IMAGE.test(value)) return [];
    if (PINNED.test(value) && !RUNS_IMAGE_BY_TAG.some((action) => value.startsWith(`${action}@`))) return [];
    return [`${i + 1}: ${value}`];
  });
}

/**
 * `<tool>: <problem>` for each tool a job downloads without an exact version, a sha256 or a script that checks it.
 * A line whose first non-space character is `#` runs nothing, so no rule reads it.
 */
export function unverifiedDownloads(job: string, tools: string[]): string[] {
  const code = job.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");
  const unchecked = /sha256sum --check\b/.test(code) ? [] : ["job: nothing runs sha256sum --check"];
  return tools.flatMap((tool) => {
    const env = (key: string) => new RegExp(`^\\s+${tool}_${key}: (\\S+)$`, "m").exec(code)?.[1];
    const version = env("VERSION");
    const sha256 = env("SHA256");
    const problems: string[] = [];
    if (version === undefined || !/^\d+\.\d+\.\d+$/.test(version)) problems.push("no exact version");
    if (sha256 === undefined || !/^[0-9a-f]{64}$/.test(sha256)) problems.push("no sha256");
    if (!code.includes(`"$${tool}_SHA256"`)) problems.push("the script never passes the sha256 to its check");
    if (!code.includes(`\${${tool}_VERSION}`)) problems.push("the download URL does not use the pinned version");
    return problems.map((p) => `${tool}: ${p}`);
  }).concat(unchecked);
}

describe("workflow pin rule applies as specified", () => {
  const DIGEST = "1e1481c65fc2407d3fd6ab18a23c741eb4d1c0d9359ebafc4b3ab13aa61d8627";

  it.each([
    ["a tag", "      - uses: actions/checkout@v4"],
    ["a branch", "        uses: foo/bar@main"],
    ["a short SHA", "      - uses: actions/checkout@11d5960 # v4.4.0"],
    ["a SHA without its version", "      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262"],
    ["a docker image", "      - uses: docker://alpine:3.20"],
    ["a docker image by tag, even with a version comment", "      - uses: docker://ghcr.io/ossf/scorecard-action:v2.5.0 # v2.5.0"],
    ["a docker image by a short digest", "      - uses: docker://ghcr.io/ossf/scorecard-action@sha256:1e1481c6 # v2.5.0"],
    ["a docker image by digest without its version", `      - uses: docker://ghcr.io/ossf/scorecard-action@sha256:${DIGEST}`],
    [
      "an action that runs its image by tag",
      "      - uses: ossf/scorecard-action@fa7117db83c52d787ae5a89f350999701505d78e # v2.5.0",
    ],
  ])("refuses %s", (_case, line) => {
    // Act & Assert
    expect(unpinnedUses(line)).toHaveLength(1);
  });

  it("passes a SHA pin with its version, a sub-path action, a digest-pinned image and a local workflow", () => {
    // Arrange
    const yaml = [
      "      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0",
      "        uses: github/codeql-action/init@0123456789abcdef0123456789abcdef01234567 # v3",
      `        uses: docker://ghcr.io/ossf/scorecard-action@sha256:${DIGEST} # v2.5.0`,
      "    uses: ./.github/workflows/reusable.yml",
      "      - run: echo uses: nothing",
    ].join("\n");

    // Act & Assert
    expect(unpinnedUses(yaml)).toEqual([]);
  });
});

describe(".github/workflows", () => {
  it("pin every external action to a commit SHA and every docker:// image to a digest, each with its version", () => {
    // Arrange
    const files = fs.readdirSync(path.join(root, WORKFLOWS)).filter((f) => /\.ya?ml$/.test(f));

    // Act
    const unpinned = files.flatMap((f) => unpinnedUses(fs.readFileSync(path.join(root, WORKFLOWS, f), "utf8")).map((u) => `${f}:${u}`));

    // Assert
    expect(files.length).toBeGreaterThan(0);
    expect(unpinned).toEqual([]);
  });
});

describe("workflow-lint download rule applies as specified", () => {
  const SHA = "a".repeat(64);
  const job = (overrides: { version?: string; sha256?: string; script?: string } = {}) =>
    [
      "    env:",
      `      LINT_VERSION: ${overrides.version ?? "1.2.3"}`,
      `      LINT_SHA256: ${overrides.sha256 ?? SHA}`,
      "    run: |",
      overrides.script ??
        [
          "      fetch() { curl --output \"$1\" \"$2\"; echo \"$3  $1\" | sha256sum --check; }",
          "      fetch lint.tar.gz \"https://example.test/v${LINT_VERSION}/lint.tar.gz\" \"$LINT_SHA256\"",
        ].join("\n"),
    ].join("\n");

  it("passes a tool with an exact version, a sha256 and a script that checks it", () => {
    // Act & Assert
    expect(unverifiedDownloads(job(), ["LINT"])).toEqual([]);
  });

  it.each([
    ["a floating version", job({ version: "latest" }), "LINT: no exact version"],
    ["a major-only version", job({ version: "1" }), "LINT: no exact version"],
    ["a short checksum", job({ sha256: "abc123" }), "LINT: no sha256"],
    ["an upper-case checksum", job({ sha256: SHA.toUpperCase() }), "LINT: no sha256"],
    [
      "a checksum the script never checks",
      job({ script: "      curl --output lint.tar.gz \"https://example.test/v${LINT_VERSION}/lint.tar.gz\"" }),
      "LINT: the script never passes the sha256 to its check",
    ],
    [
      "a URL that skips the pinned version",
      job({
        script: [
          "      fetch() { curl --output \"$1\" \"$2\"; echo \"$3  $1\" | sha256sum --check; }",
          "      fetch lint.tar.gz \"https://example.test/latest/lint.tar.gz\" \"$LINT_SHA256\"",
        ].join("\n"),
      }),
      "LINT: the download URL does not use the pinned version",
    ],
    [
      "a function that never runs sha256sum",
      job({
        script: [
          "      fetch() { curl --output \"$1\" \"$2\"; }",
          "      fetch lint.tar.gz \"https://example.test/v${LINT_VERSION}/lint.tar.gz\" \"$LINT_SHA256\"",
        ].join("\n"),
      }),
      "job: nothing runs sha256sum --check",
    ],
    [
      "a checksum check that sits in a comment",
      job({
        script: [
          "      fetch() { curl --output \"$1\" \"$2\"; }",
          "      # echo \"$3  $1\" | sha256sum --check",
          "      fetch lint.tar.gz \"https://example.test/v${LINT_VERSION}/lint.tar.gz\" \"$LINT_SHA256\"",
        ].join("\n"),
      }),
      "job: nothing runs sha256sum --check",
    ],
    [
      "a sha256 that only a commented-out call passes to the check",
      job({
        script: [
          "      fetch() { curl --output \"$1\" \"$2\"; echo \"$3  $1\" | sha256sum --check; }",
          "      # fetch lint.tar.gz \"https://example.test/v${LINT_VERSION}/lint.tar.gz\" \"$LINT_SHA256\"",
          "      fetch lint.tar.gz \"https://example.test/v${LINT_VERSION}/lint.tar.gz\" abc",
        ].join("\n"),
      }),
      "LINT: the script never passes the sha256 to its check",
    ],
    [
      "a pinned version that only a commented-out URL uses",
      job({
        script: [
          "      fetch() { curl --output \"$1\" \"$2\"; echo \"$3  $1\" | sha256sum --check; }",
          "      # fetch lint.tar.gz \"https://example.test/v${LINT_VERSION}/lint.tar.gz\" \"$LINT_SHA256\"",
          "      fetch lint.tar.gz \"https://example.test/latest/lint.tar.gz\" \"$LINT_SHA256\"",
        ].join("\n"),
      }),
      "LINT: the download URL does not use the pinned version",
    ],
  ])("refuses %s", (_case, yaml, problem) => {
    // Act & Assert
    expect(unverifiedDownloads(yaml, ["LINT"])).toContain(problem);
  });
});

describe("ci.yml workflow-lint", () => {
  const ci = fs.readFileSync(path.join(root, WORKFLOWS, "ci.yml"), "utf8");
  const lint = /^ {2}workflow-lint:\n((?: {4}.*\n|\s*\n)*)/m.exec(ci)?.[1] ?? "";

  it("downloads actionlint and zizmor at an exact version and a sha256 its script checks", () => {
    // Assert
    expect(lint).not.toBe("");
    expect(unverifiedDownloads(lint, ["ACTIONLINT", "ZIZMOR"])).toEqual([]);
  });

  it("names no floating release anywhere in the workflow", () => {
    // Assert
    expect(ci).not.toMatch(/releases\/latest|\/latest\/download|@latest/);
  });
});

describe(".github/dependabot.yml", () => {
  /** Each `- package-ecosystem:` entry of `updates`, in file order, with its comment lines dropped. */
  function ecosystemBlocks(): Array<[string, string]> {
    const config = fs.readFileSync(path.join(root, ".github/dependabot.yml"), "utf8").replace(/^\s*#.*\n/gm, "");
    return config
      .split(/^(?=\s*- package-ecosystem: )/m)
      .slice(1)
      .map((block) => [/^\s*- package-ecosystem: (\S+)$/m.exec(block)?.[1] ?? "", block]);
  }

  it("takes github-actions version updates monthly into dev and npm security updates only, with no target branch", () => {
    // Act
    const blocks = ecosystemBlocks();
    const [actions, npm] = blocks.map(([, block]) => block);

    // Assert
    expect(blocks.map(([ecosystem]) => ecosystem)).toEqual(["github-actions", "npm"]);
    expect(actions).toMatch(/^ {4}schedule:\n {6}interval: monthly$/m);
    expect(actions).toMatch(/^ {4}target-branch: dev$/m);
    expect(actions).toMatch(/^ {4}groups:\n {6}github-actions:\n {8}patterns:\n {10}- "\*"$/m);
    expect(npm).toMatch(/^ {4}directory: \/$/m);
    expect(npm).toMatch(/^ {4}open-pull-requests-limit: 0$/m);
    expect(npm).toMatch(/^ {4}groups:\n {6}nestjs:\n {8}applies-to: security-updates\n {8}patterns:\n {10}- "@nestjs\/\*"$/m);
    expect(npm).not.toMatch(/target-branch/);
    expect(blocks.filter(([, block]) => /target-branch/.test(block)).map(([ecosystem]) => ecosystem)).toEqual(["github-actions"]);
  });
});
