/**
 * The registry's wire shapes. What it guards: both image spellings leave as one
 * absolute `uri` (a path under the web origin, a media URL as it is) and an
 * emoji passes through; an index entry carries only its named fields, with the
 * optional ones absent rather than undefined.
 */
import { resolveLogo, toIndexEntry } from "./miniapps.mapper";
import type { MiniAppIndexEntryRaw } from "./miniapps.schema";

const WEB = "https://web.test";

describe("resolveLogo", () => {
  it.each([
    ["a path under the web origin", { kind: "remote", path: "/miniapps/a.png" }, { kind: "remote", uri: `${WEB}/miniapps/a.png` }],
    ["a media URL as it is", { kind: "media", url: "https://media.test/a.jpg" }, { kind: "remote", uri: "https://media.test/a.jpg" }],
    ["an emoji", { kind: "emoji", emoji: "😋" }, { kind: "emoji", emoji: "😋" }],
  ] as const)("serves %s", (_label, logo, served) => {
    // Act & Assert
    expect(resolveLogo(logo, WEB)).toEqual(served);
  });
});

describe("toIndexEntry", () => {
  const entry: MiniAppIndexEntryRaw = {
    id: "a",
    name: "A",
    order: 3,
    homeLogo: { kind: "emoji", emoji: "📖" },
    shellLogo: { kind: "remote", path: "/a.png" },
  };

  it("serves the named fields in order, without the optional ones it does not set", () => {
    // Act
    const served = toIndexEntry(entry, WEB);

    // Assert
    expect(JSON.stringify(served)).toBe(
      JSON.stringify({ id: "a", name: "A", order: 3, homeLogo: { kind: "emoji", emoji: "📖" }, shellLogo: { kind: "remote", uri: `${WEB}/a.png` } }),
    );
    expect(served).not.toHaveProperty("hidden");
    expect(served).not.toHaveProperty("shortName");
  });

  it("keeps shortName and hidden where the file sets them", () => {
    // Act
    const served = toIndexEntry({ ...entry, shortName: "a", hidden: false }, WEB);

    // Assert
    expect(Object.keys(served)).toEqual(["id", "name", "shortName", "order", "homeLogo", "shellLogo", "hidden"]);
  });
});
