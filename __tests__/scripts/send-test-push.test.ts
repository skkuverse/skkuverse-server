/**
 * scripts/send-test-push.js is run by hand when a push does not arrive, so a
 * failure must say what to fix: a mistyped option is a usage error (exit 2,
 * one line, no stack trace), and when gcloud cannot mint a token the output
 * carries gcloud's own first error line, which tells "not logged in" from
 * "no token-creator grant". The script is run as a child process with a fake
 * `gcloud` first on PATH, so nothing reaches Google.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = path.join(__dirname, "../../scripts/send-test-push.js");

function run(args: string[], env: NodeJS.ProcessEnv = process.env): { status: number | null; stdout: string; stderr: string } {
  const child = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env, timeout: 30_000 });
  return { status: child.status, stdout: child.stdout, stderr: child.stderr };
}

describe("send-test-push.js arguments", () => {
  it("exits 2 with one line, not a stack trace, on an option it does not know", () => {
    // Act
    const result = run(["--token", "t", "--bogus"]);

    // Assert
    expect(result.status).toBe(2);
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect(result.stderr).toMatch(/--bogus/);
    expect(result.stderr).not.toMatch(/^\s+at /m);
  });
});

describe("send-test-push.js without the Firebase project or the sender", () => {
  // The repository is public, so neither value is written in the script: each comes from the caller.
  it.each([
    ["--project", ["--token", "t", "--impersonate", "sender@project.example"]],
    ["--impersonate", ["--token", "t", "--project", "project-example"]],
  ])("exits 2 with one line naming %s when it is missing", (option, args) => {
    // Act
    const result = run(args);

    // Assert
    expect(result.status).toBe(2);
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect(result.stderr).toMatch(new RegExp(`missing ${option}`));
  });

  it("names neither value in its source", () => {
    // Act
    const source = fs.readFileSync(SCRIPT, "utf8");

    // Assert
    expect(source).not.toMatch(/iam\.gserviceaccount\.com/);
    expect(source).not.toMatch(/const PROJECT_ID = "/);
  });
});

describe("send-test-push.js when gcloud cannot mint a token", () => {
  let fakeBin: string;

  beforeAll(() => {
    fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "fake-gcloud-"));
    fs.writeFileSync(
      path.join(fakeBin, "gcloud"),
      [
        "#!/bin/sh",
        'echo "ERROR: (gcloud.auth.print-access-token) You do not currently have an active account selected." >&2',
        'echo "Please run: gcloud auth login" >&2',
        "exit 1",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
  });

  afterAll(() => {
    fs.rmSync(fakeBin, { recursive: true, force: true });
  });

  it("prints gcloud's first error line and exits 1", () => {
    // Arrange
    const env = { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` };

    // Act
    const result = run(["--token", "device-token-not-printed", "--project", "project-example", "--impersonate", "sender@project.example"], env);

    // Assert
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/You do not currently have an active account selected/);
    expect(result.stdout).not.toMatch(/Please run/);
    expect(result.stdout).not.toMatch(/device-token-not-printed/);
  });
});
