/**
 * The on-disk pieces home and campus share: a captured banner image parses and
 * a copy missing each required field does not; a link action is checked by its
 * type's rule (a registered mini-app target, an https URL, a web view URL, a
 * root-relative route), never with whitespace; and a failed parse throws one
 * line that starts with the file's label and names each path.
 */
import { z } from "zod";
import { MiniAppsService } from "../miniapps/miniapps.service";
import { bannerImage, isBrokenLinkAction, parseConfigFile } from "./ui.schema";

const registry = new MiniAppsService();

const CAPTURED_IMAGE = {
  type: "image",
  id: "eskara-2026-banner-01",
  imageUrl: "https://media.skkuverse.com/campus/banners/eskara-2026-01-c4967cf8.webp",
  alt: { ko: "청랑 현수막: 조선에~서~ 누가 돌아왔게~" },
  endAt: "2026-10-03T00:00:00+09:00",
};

describe("bannerImage", () => {
  it("parses a banner from campus-banners.json", () => {
    // Act & Assert
    expect(bannerImage.safeParse(CAPTURED_IMAGE).success).toBe(true);
  });

  it.each(["type", "id", "imageUrl", "alt"])("refuses a banner without its %s", (field) => {
    // Arrange
    const rest: Record<string, unknown> = { ...CAPTURED_IMAGE };
    delete rest[field];

    // Act & Assert
    expect(bannerImage.safeParse(rest).success).toBe(false);
  });

  it.each(["actionType", "actionValue", "startAt", "endAt"])("accepts a banner without its %s", (field) => {
    // Arrange
    const rest: Record<string, unknown> = { ...CAPTURED_IMAGE };
    delete rest[field];

    // Act & Assert
    expect(bannerImage.safeParse(rest).success).toBe(true);
  });
});

describe("isBrokenLinkAction", () => {
  it.each([
    ["miniapp", "eskara-2026", false],
    ["miniapp", "eskara-2026/eskara/wristband", false],
    ["miniapp", "no-such-app", true],
    ["external", "https://pf.kakao.com/_cjxexdG/chat", false],
    ["external", "http://pf.kakao.com/_cjxexdG/chat", true],
    ["external", "/x", true],
    ["webview", "https://webview.skkuverse.com/skku/lostandfound", false],
    ["webview", "https://webview.skkuverse.com/a b", true],
    ["route", "/map/hssc", false],
    ["route", "//evil.com", true],
    ["route", "campus", true],
    ["route", "", true],
    ["route", "/search\n", true],
  ] as const)("%s %p: broken is %p", (actionType, actionValue, expected) => {
    // Act & Assert
    expect(isBrokenLinkAction({ actionType, actionValue }, registry)).toBe(expected);
  });

  it("finds nothing broken in a banner without an action", () => {
    // Act & Assert
    expect(isBrokenLinkAction({}, registry)).toBe(false);
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
