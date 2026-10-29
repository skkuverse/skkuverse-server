/**
 * The image runs the Node major that CI and the tests run on. CI takes its Node from .nvmrc, while the Dockerfile runs
 * `npm ci` before .npmrc is copied in, so engine-strict never checks the image: a stage left on an older tag still builds.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.join(__dirname, "../../..");
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), "utf8");

describe("the Node major", () => {
  it("is the .nvmrc major in every Dockerfile stage", () => {
    // Arrange
    const major = read(".nvmrc").trim();

    // Act
    const majors = [...read("Dockerfile").matchAll(/^FROM\s+(\S+)/gim)].map((m) => /^node:(\d+)(?:[.-]|$)/.exec(m[1]!)?.[1]);

    // Assert
    expect(majors).not.toHaveLength(0);
    expect(majors).toEqual(majors.map(() => major));
  });
});
