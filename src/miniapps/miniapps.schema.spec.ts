/**
 * registryFile, the structure of the committed mini-app registry. What it
 * guards: the committed index.json and details/*.json pass; a file missing
 * either half fails; an index entry gets both logos, the absent one taking
 * the other's; and a detail's shell keeps only the fields it sets. The words
 * a refusal names its entry with are miniapps.config.spec.ts's.
 */
import fs from "fs";
import path from "path";
import { registryFile } from "./miniapps.schema";

const readJson = (...segments: string[]): unknown => JSON.parse(fs.readFileSync(path.join(__dirname, ...segments), "utf8"));

const index = readJson("index.json") as { miniApps: Array<{ id: string }> };
const committed = {
  index,
  details: Object.fromEntries(index.miniApps.map(({ id }) => [id, readJson("details", `${id}.json`)])),
};

const DETAIL = { version: 1, id: "a", startUrl: "https://a.test/", verified: true, relatedLinks: [] };

describe("registryFile", () => {
  it("passes the committed registry", () => {
    // Act & Assert
    expect(registryFile.safeParse(committed).success).toBe(true);
  });

  it.each(Object.keys(registryFile.shape))("fails a registry missing %s", (field) => {
    // Arrange
    const missing: Record<string, unknown> = { ...committed };
    delete missing[field];

    // Act & Assert
    expect(registryFile.safeParse(missing).success).toBe(false);
  });

  it("gives an entry with one logo that logo in both slots", () => {
    // Arrange
    const emoji = { kind: "emoji", emoji: "😋" };
    const raw = { index: { version: 1, miniApps: [{ id: "a", name: "A", order: 1, shellLogo: emoji }] }, details: { a: DETAIL } };

    // Act
    const [entry] = registryFile.parse(raw).index.miniApps;

    // Assert
    expect(entry).toMatchObject({ homeLogo: emoji, shellLogo: emoji });
  });

  it("keeps a detail's shell to the fields it sets", () => {
    // Arrange
    const raw = { index: { version: 1, miniApps: [] }, details: { a: { ...DETAIL, shell: { bar: "top" } } } };

    // Act & Assert
    expect(registryFile.parse(raw).details.a?.shell).toEqual({ bar: "top" });
  });
});
