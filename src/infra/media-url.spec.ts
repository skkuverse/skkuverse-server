/**
 * A media URL names an object on the media host: a look-alike host is refused.
 */
import { isMediaUrl } from "./media-url";

describe("isMediaUrl", () => {
  it("accepts only objects on the media host", () => {
    // Act & Assert
    expect(isMediaUrl("https://media.skkuverse.com/a.png")).toBe(true);
    expect(isMediaUrl("https://media.skkuverse.com.evil.com/a.png")).toBe(false);
  });
});
