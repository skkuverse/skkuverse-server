/**
 * Every external action a workflow runs is pinned to a commit, and Dependabot
 * keeps the pins current (PR 234 F13):
 *
 *   - each `uses:` in `.github/workflows/*.yml` is a local `./…` workflow or
 *     `<owner>/<repo>[/<path>]@<40 hex>` followed by `# v<version>`, so a tag
 *     moved upstream cannot change what runs, and a reader still sees which
 *     release it is;
 *   - `.github/dependabot.yml` updates the `github-actions` ecosystem only,
 *     monthly, as one grouped pull request into `dev`.
 *
 * Patterns rather than a YAML parser: the repo avoids the dependency.
 */
import fs from "fs";
import path from "path";

const root = path.join(__dirname, "../../..");
const WORKFLOWS = ".github/workflows";
const PINNED = /^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40} # v\d+(?:\.\d+)*$/;

/** `<line>: <uses value>` for each `uses:` that is neither local nor pinned to a SHA with its version. */
export function unpinnedUses(yaml: string): string[] {
  return yaml.split("\n").flatMap((line, i) => {
    const value = /^\s*(?:-\s+)?uses:\s*(.*?)\s*$/.exec(line)?.[1];
    if (value === undefined || value.startsWith("./") || PINNED.test(value)) return [];
    return [`${i + 1}: ${value}`];
  });
}

describe("workflow pin rule applies as specified", () => {
  it.each([
    ["a tag", "      - uses: actions/checkout@v4"],
    ["a branch", "        uses: foo/bar@main"],
    ["a short SHA", "      - uses: actions/checkout@11d5960 # v4.4.0"],
    ["a SHA without its version", "      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262"],
    ["a docker image", "      - uses: docker://alpine:3.20"],
  ])("refuses %s", (_case, line) => {
    // Act & Assert
    expect(unpinnedUses(line)).toHaveLength(1);
  });

  it("passes a SHA pin with its version, a sub-path action and a local workflow", () => {
    // Arrange
    const yaml = [
      "      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0",
      "        uses: github/codeql-action/init@0123456789abcdef0123456789abcdef01234567 # v3",
      "    uses: ./.github/workflows/reusable.yml",
      "      - run: echo uses: nothing",
    ].join("\n");

    // Act & Assert
    expect(unpinnedUses(yaml)).toEqual([]);
  });
});

describe(".github/workflows", () => {
  it("pin every external action to a commit SHA with its version", () => {
    // Arrange
    const files = fs.readdirSync(path.join(root, WORKFLOWS)).filter((f) => /\.ya?ml$/.test(f));

    // Act
    const unpinned = files.flatMap((f) => unpinnedUses(fs.readFileSync(path.join(root, WORKFLOWS, f), "utf8")).map((u) => `${f}:${u}`));

    // Assert
    expect(files.length).toBeGreaterThan(0);
    expect(unpinned).toEqual([]);
  });
});

describe(".github/dependabot.yml", () => {
  it("updates the github-actions pins only, monthly, in one grouped pull request into dev", () => {
    // Arrange
    const config = fs.readFileSync(path.join(root, ".github/dependabot.yml"), "utf8");

    // Act
    const ecosystems = [...config.matchAll(/^\s*- package-ecosystem: (\S+)$/gm)].map((m) => m[1]);

    // Assert
    expect(ecosystems).toEqual(["github-actions"]);
    expect(config).toMatch(/^ {4}schedule:\n {6}interval: monthly$/m);
    expect(config).toMatch(/^ {4}target-branch: dev$/m);
    expect(config).toMatch(/^ {4}groups:\n {6}github-actions:\n {8}patterns:\n {10}- "\*"$/m);
  });
});
