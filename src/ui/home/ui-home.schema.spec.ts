/**
 * The structure of home-layout.json: the committed file parses, a copy missing
 * either top-level field does not, a feed section without a limit gets the
 * default one, and ids repeat neither across sections and banners nor across
 * tiles.
 */
import fs from "fs";
import path from "path";
import { DEFAULT_MINIAPP_FEED_LIMIT } from "./ui-home.constants";
import { homeLayoutFile } from "./ui-home.schema";

const COMMITTED = JSON.parse(fs.readFileSync(path.join(__dirname, "home-layout.json"), "utf8")) as Record<string, unknown>;

const feed = { type: "miniapp_feed", id: "eskara_feed", miniAppId: "eskara-2026" };
const grid = (id: string, tileId: string) => ({ type: "tile_grid", id, tiles: [{ kind: "game", id: tileId }] });

describe("homeLayoutFile", () => {
  it("parses the committed home-layout.json", () => {
    // Act & Assert
    expect(homeLayoutFile.safeParse(COMMITTED).success).toBe(true);
  });

  it.each(Object.keys(homeLayoutFile.shape))("refuses a layout without its %s", (field) => {
    // Arrange
    const rest: Record<string, unknown> = { ...COMMITTED };
    delete rest[field];

    // Act & Assert
    expect(homeLayoutFile.safeParse(rest).success).toBe(false);
  });

  it("gives a feed section without a limit the default one", () => {
    // Act
    const parsed = homeLayoutFile.parse({ version: 1, sections: [feed] });

    // Assert
    expect(parsed.sections[0]).toMatchObject({ limit: DEFAULT_MINIAPP_FEED_LIMIT });
  });

  it("refuses a section id used twice and a tile placed twice, and accepts each once", () => {
    // Act & Assert
    expect(homeLayoutFile.safeParse({ version: 1, sections: [grid("a", "x"), grid("b", "y")] }).success).toBe(true);
    expect(homeLayoutFile.safeParse({ version: 1, sections: [grid("a", "x"), grid("a", "y")] }).success).toBe(false);
    expect(homeLayoutFile.safeParse({ version: 1, sections: [grid("a", "x"), grid("b", "x")] }).success).toBe(false);
  });
});
