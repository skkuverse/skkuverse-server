/**
 * placeLexiconFile, the shape of the committed place lexicon: the file as
 * committed parses, a copy missing any key fails (so a dropped table fails
 * the boot instead of resolving less), an unknown key fails (so a misspelt
 * table is not ignored), and a facility slug is a lowercase id, never a
 * display name.
 */
import fs from "fs";
import path from "path";
import { placeLexiconFile } from "./building-place.schema";

const committed = (): Record<string, unknown> => JSON.parse(fs.readFileSync(path.join(__dirname, "place-lexicon.json"), "utf8")) as Record<string, unknown>;

describe("placeLexiconFile", () => {
  it("parses the committed lexicon", () => {
    // Act & Assert
    expect(placeLexiconFile.safeParse(committed()).success).toBe(true);
  });

  it.each(Object.keys(placeLexiconFile.shape))("fails without %s", (key) => {
    // Arrange
    const lexicon = committed();
    delete lexicon[key];

    // Act & Assert
    expect(placeLexiconFile.safeParse(lexicon).success).toBe(false);
  });

  it("fails on a key it does not know", () => {
    // Act & Assert
    expect(placeLexiconFile.safeParse({ ...committed(), buildingAlias: [] }).success).toBe(false);
  });

  it("fails on a facility slug that is a name, not an id", () => {
    // Act & Assert
    expect(placeLexiconFile.safeParse({ ...committed(), facilitySlugs: { "64": "금잔디광장" } }).success).toBe(false);
  });
});
