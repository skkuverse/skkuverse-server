/**
 * isOwnStoreListing, the one address a platform's gate may send users to: this app's own listing in that
 * platform's store, compared character for character. Each platform takes only its own store's address.
 */
import { isOwnStoreListing } from "./app-config.rules";

const IOS_LISTING = "https://apps.apple.com/app/id6446813434";
const ANDROID_LISTING = "https://play.google.com/store/apps/details?id=com.zoyoong.skkubus";

describe("isOwnStoreListing", () => {
  it.each([
    ["ios", IOS_LISTING],
    ["android", ANDROID_LISTING],
  ] as const)("takes the production %s listing", (platform, url) => {
    // Act & Assert
    expect(isOwnStoreListing(platform, url)).toBe(true);
  });

  it.each([
    ["ios", ANDROID_LISTING],
    ["android", IOS_LISTING],
    ["ios", `${IOS_LISTING}0`],
    ["android", `${ANDROID_LISTING}&hl=ko`],
    ["android", `${ANDROID_LISTING}.evil`],
    ["ios", ""],
  ] as const)("refuses %s %j", (platform, url) => {
    // Act & Assert
    expect(isOwnStoreListing(platform, url)).toBe(false);
  });
});
