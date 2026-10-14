/**
 * The sheet's image URL schema: an image block is kept only when its URL names
 * an object on the media host.
 */
import { mediaUrl } from "./map-event-details.schema";

describe("mediaUrl", () => {
  it("accepts only objects on the media host", () => {
    // Act & Assert
    expect(mediaUrl.safeParse("https://media.skkuverse.com/a.png").success).toBe(true);
    expect(mediaUrl.safeParse("https://media.skkuverse.com.evil.com/a.png").success).toBe(false);
  });
});
