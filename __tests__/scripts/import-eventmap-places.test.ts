/**
 * scripts/import-eventmap-places.js writes the festival sheet into eventmap
 * `places`, and production when NODE_ENV=production. The committed sheet holds
 * synthetic Instagram handles (`example_club_NN`) in place of the real ones, so
 * a production run must name its sheet and must never import a synthetic one:
 * it would overwrite the real handles the map serves. What it guards: `--file`
 * has no default, and with NODE_ENV=production a sheet whose `_readme` calls it
 * synthetic, or that names an `example_club_` handle, is refused before any
 * connection. The script runs as a child process in an empty folder with no
 * MONGO_URL, so a run that gets past the refusal stops at "MONGO_URL not set"
 * and nothing reaches a database.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = path.join(__dirname, "../../scripts/import-eventmap-places.js");
const COMMITTED_SHEET = path.join(__dirname, "../../scripts/data/eskara-2026-places.json");

let workDir: string;

/** Runs the importer with no MONGO_URL, from a folder with no `.env` for dotenv to load. */
function runImport(args: string[], nodeEnv: string): { status: number | null; stderr: string } {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("MONGO_")));
  const child = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: workDir, encoding: "utf8", env: { ...env, NODE_ENV: nodeEnv }, timeout: 30_000 });
  return { status: child.status, stderr: child.stderr };
}

function sheetFile(name: string, sheet: Record<string, unknown>): string {
  const file = path.join(workDir, name);
  fs.writeFileSync(file, JSON.stringify(sheet));
  return file;
}

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "import-eventmap-"));
});

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe("import-eventmap-places.js --file", () => {
  it("exits 1 naming --file when none is given, before reading a sheet or connecting", () => {
    // Act
    const result = runImport(["--dry-run"], "development");

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--file is required/);
    expect(result.stderr).not.toMatch(/MONGO_URL/);
  });
});

describe("import-eventmap-places.js with NODE_ENV=production", () => {
  it("refuses the committed sheet, whose handles are synthetic", () => {
    // Act
    const result = runImport(["--file", COMMITTED_SHEET, "--dry-run"], "production");

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/refusing: .*synthetic/);
    expect(result.stderr).not.toMatch(/MONGO_URL/);
  });

  it.each([
    ["a `_readme` line that calls the sheet synthetic", { _readme: ["The handles below are Synthetic."], places: [] }],
    ["a `_readme` string that calls the sheet synthetic", { _readme: "synthetic data", places: [] }],
    ["an example_club_ handle", { places: [{ id: "booth-01", url: "https://www.instagram.com/example_club_07/" }] }],
  ])("refuses a sheet with %s", (_label, sheet) => {
    // Arrange
    const file = sheetFile("marked.json", sheet);

    // Act
    const result = runImport(["--file", file], "production");

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/refusing: /);
    expect(result.stderr).not.toMatch(/MONGO_URL/);
  });

  it("passes a sheet with no synthetic marker on to the connection", () => {
    // Arrange
    const file = sheetFile("real.json", { _readme: ["Real 2026 data."], places: [{ id: "booth-01", url: "https://www.instagram.com/a_real_club/" }] });

    // Act
    const result = runImport(["--file", file], "production");

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/MONGO_URL not set/);
    expect(result.stderr).not.toMatch(/refusing: /);
  });
});

describe("import-eventmap-places.js outside production", () => {
  it("takes the committed synthetic sheet for the _dev databases", () => {
    // Act
    const result = runImport(["--file", COMMITTED_SHEET, "--dry-run"], "development");

    // Assert
    expect(result.stderr).toMatch(/MONGO_URL not set/);
    expect(result.stderr).not.toMatch(/refusing: /);
  });
});
