/**
 * The Instagram links a sheet button may open (one profile segment that is
 * not one of Instagram's own pages, or a post), the place kinds the app's
 * closed union accepts, and which places have no sheet to open: a category
 * authored inert, or one whose tap runs a chip.
 */
import { isInstagramPostUrl, isInstagramProfileUrl, isNonBlankId, isPlaceKind, sheetlessReason } from "./map-event-details.rules";
import { fixtureLayerSet } from "../../../__tests__/helpers/map/layer-sets-fixture";

describe("isInstagramProfileUrl", () => {
  it.each([
    ["https://www.instagram.com/example_council", true],
    ["https://instagram.com/example_council/", true],
    ["https://www.instagram.com/explore", false],
    ["https://www.instagram.com/p/abc", false],
    ["https://instagram.com.evil.com/x", false],
    ["http://instagram.com/x", false],
    [null, false],
  ])("judges %p a profile: %s", (value, expected) => {
    // Act & Assert
    expect(isInstagramProfileUrl(value)).toBe(expected);
  });
});

describe("isInstagramPostUrl", () => {
  it.each([
    ["https://www.instagram.com/p/C1abc", true],
    ["https://www.instagram.com/reel/C1abc", true],
    ["https://www.instagram.com/stories/C1abc", false],
    ["https://www.instagram.com/p/C1abc/extra", false],
    ["https://www.instagram.com/p", false],
  ])("judges %p a post: %s", (value, expected) => {
    // Act & Assert
    expect(isInstagramPostUrl(value)).toBe(expected);
  });
});

describe("isNonBlankId and isPlaceKind", () => {
  it("accepts a written id and a kind the app knows", () => {
    // Act & Assert
    expect(isNonBlankId("menu")).toBe(true);
    expect(isNonBlankId(" ")).toBe(false);
    expect(isPlaceKind("foodTruck")).toBe(true);
    expect(isPlaceKind("concert")).toBe(false);
  });
});

describe("sheetlessReason", () => {
  const CONFIG = fixtureLayerSet();

  it.each([
    ["a booth, which taps to its place", "booth", null],
    ["a category the table does not list, which falls back to a tappable one", "전시", null],
    ["a category authored interactive: false", "control_entry_label", 'p: category "control_entry_label" is not tappable'],
    ["a category whose tap runs a chip", "food_zone", 'p: category "food_zone" taps to chip "eskara26_view_food"'],
  ])("answers %s", (_case, category, reason) => {
    // Act & Assert
    expect(sheetlessReason({ _id: "p", category }, CONFIG)).toBe(reason);
  });
});
