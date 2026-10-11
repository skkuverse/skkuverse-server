/**
 * The Instagram links a sheet button may open (one profile segment that is
 * not one of Instagram's own pages, or a post), and the place kinds the app's
 * closed union accepts.
 */
import { isInstagramPostUrl, isInstagramProfileUrl, isNonBlankId, isPlaceKind } from "./map-event-details.rules";

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
