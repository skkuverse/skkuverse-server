/**
 * The structure of campus-banners.json: the committed file parses, a copy
 * missing any carousel field does not, and the carousel id and its banner ids
 * are one namespace.
 */
import fs from "fs";
import path from "path";
import { campusBannersFile } from "./ui-campus.schema";

const COMMITTED = JSON.parse(fs.readFileSync(path.join(__dirname, "campus-banners.json"), "utf8")) as Record<
  string,
  unknown
>;

describe("campusBannersFile", () => {
  it("parses the committed campus-banners.json", () => {
    // Act & Assert
    expect(campusBannersFile.safeParse(COMMITTED).success).toBe(true);
  });

  it.each(Object.keys(campusBannersFile.shape))("refuses a carousel without its %s", (field) => {
    // Arrange
    const rest: Record<string, unknown> = { ...COMMITTED };
    delete rest[field];

    // Act & Assert
    expect(campusBannersFile.safeParse(rest).success).toBe(false);
  });

  it("refuses two banners with one id", () => {
    // Arrange
    const [first] = COMMITTED.items as Record<string, unknown>[];
    const twice = { ...COMMITTED, items: [first, first] };

    // Act & Assert
    expect(campusBannersFile.safeParse(twice).success).toBe(false);
  });
});
