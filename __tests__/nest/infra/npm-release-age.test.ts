/**
 * `.npmrc` sets `min-release-age` to at least 5 days, so every npm that resolves versions in a checkout of this
 * repository skips a release younger than that, whatever the user's own npm config says. `npm ci` installs the
 * lockfile as it is and is not affected.
 */
import fs from "fs";
import path from "path";

const MIN_RELEASE_AGE_DAYS = 5;

const npmrc = fs.readFileSync(path.join(__dirname, "../../../.npmrc"), "utf8");

function releaseAgeDays(text: string): number | undefined {
  const line = text
    .split("\n")
    .map((raw) => raw.trim())
    .find((trimmed) => /^min-release-age\s*=/.test(trimmed));
  return line === undefined ? undefined : Number(line.split("=")[1]?.trim());
}

describe("min-release-age in .npmrc", () => {
  it("reads the value of the min-release-age line, and nothing when there is none", () => {
    // Act & Assert
    expect(releaseAgeDays("save-exact=true\nmin-release-age=7\n")).toBe(7);
    expect(releaseAgeDays("  min-release-age = 10 ")).toBe(10);
    expect(releaseAgeDays("save-exact=true\n")).toBeUndefined();
  });

  it(`holds back a release younger than ${MIN_RELEASE_AGE_DAYS} days`, () => {
    // Act
    const days = releaseAgeDays(npmrc);

    // Assert
    expect(days).toBeGreaterThanOrEqual(MIN_RELEASE_AGE_DAYS);
  });
});
