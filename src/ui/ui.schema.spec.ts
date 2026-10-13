/**
 * The on-disk pieces home and campus share: a captured banner image parses and
 * a copy missing each required field does not; a carousel rotates never (0)
 * or every 2 to 30 whole seconds; and a failed parse throws one
 * line that starts with the file's label and names each path.
 */
import { z } from "zod";
import { MAX_AUTO_ROTATE_SEC, MIN_AUTO_ROTATE_SEC } from "./ui.constants";
import { bannerImageFile, carouselFields, parseConfigFile } from "./ui.schema";

const CAPTURED_IMAGE = {
  type: "image",
  id: "eskara-2026-banner-01",
  imageUrl: "https://media.skkuverse.com/campus/banners/eskara-2026-01-c4967cf8.webp",
  alt: { ko: "청랑 현수막: 조선에~서~ 누가 돌아왔게~" },
  endAt: "2026-10-03T00:00:00+09:00",
};

describe("bannerImageFile", () => {
  it("parses a banner from campus-banners.json", () => {
    // Act & Assert
    expect(bannerImageFile.safeParse(CAPTURED_IMAGE).success).toBe(true);
  });

  it.each(["type", "id", "imageUrl", "alt"])("refuses a banner without its %s", (field) => {
    // Arrange
    const rest: Record<string, unknown> = { ...CAPTURED_IMAGE };
    delete rest[field];

    // Act & Assert
    expect(bannerImageFile.safeParse(rest).success).toBe(false);
  });

  it.each(["actionType", "actionValue", "startAt", "endAt"])("accepts a banner without its %s", (field) => {
    // Arrange
    const rest: Record<string, unknown> = { ...CAPTURED_IMAGE };
    delete rest[field];

    // Act & Assert
    expect(bannerImageFile.safeParse(rest).success).toBe(true);
  });
});

describe("carouselFields", () => {
  it.each([
    [0, true],
    [MIN_AUTO_ROTATE_SEC - 1, false],
    [MIN_AUTO_ROTATE_SEC, true],
    [MIN_AUTO_ROTATE_SEC + 1, true],
    [MAX_AUTO_ROTATE_SEC - 1, true],
    [MAX_AUTO_ROTATE_SEC, true],
    [MAX_AUTO_ROTATE_SEC + 1, false],
    [2.5, false],
  ])("takes an autoRotateSec of %p: %p", (sec, expected) => {
    // Act & Assert
    expect(carouselFields.autoRotateSec.safeParse(sec).success).toBe(expected);
  });

  it("names the allowed rotations when it refuses one", () => {
    // Act
    const parsed = carouselFields.autoRotateSec.safeParse(MAX_AUTO_ROTATE_SEC + 1);

    // Assert
    expect(parsed.error?.issues.map((issue) => issue.message)).toEqual([
      `must be 0 (off) or a whole number from ${MIN_AUTO_ROTATE_SEC} to ${MAX_AUTO_ROTATE_SEC}`,
    ]);
  });
});

describe("parseConfigFile", () => {
  const schema = z.strictObject({ id: z.string(), items: z.array(z.int()) });

  it("returns the parsed value", () => {
    // Act & Assert
    expect(parseConfigFile("x file", schema, { id: "a", items: [1] })).toEqual({ id: "a", items: [1] });
  });

  it("throws one line naming each failed path after the label", () => {
    // Act & Assert
    expect(() => parseConfigFile("x file", schema, { id: 1, items: [1, "2"], extra: true })).toThrow(
      /^x file: id: .+; items\.1: .+; root: Unrecognized key: "extra"$/,
    );
  });
});
