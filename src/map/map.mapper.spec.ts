/**
 * toI18nText: every text the overlay routes send carries `ko` and `en`, with
 * `en` falling back to `ko` and a blank translation counted as missing, and
 * `zh` only when it was authored.
 */
import { toI18nText } from "./map.mapper";

describe("toI18nText", () => {
  it.each([
    [{ ko: "부스", en: "Booth", zh: "摊位" }, { ko: "부스", en: "Booth", zh: "摊位" }],
    [{ ko: "부스" }, { ko: "부스", en: "부스" }],
    [{ ko: "부스", en: "" }, { ko: "부스", en: "부스" }],
    [{ ko: "", en: "Booth" }, { ko: "Booth", en: "Booth" }],
    [{ ko: "", zh: "摊位" }, { ko: "摊位", en: "摊位", zh: "摊位" }],
    [{ ko: "부스", zh: "" }, { ko: "부스", en: "부스" }],
  ])("resolves %j to %j", (text, expected) => {
    // Act & Assert
    expect(toI18nText(text)).toEqual(expected);
  });

  it("leaves zh out rather than sending it undefined", () => {
    // Act
    const resolved = toI18nText({ ko: "부스", en: "Booth" });

    // Assert
    expect(Object.keys(resolved)).toEqual(["ko", "en"]);
  });
});
