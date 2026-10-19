/**
 * The registry's wire shapes. What it guards: both image spellings leave as one
 * absolute `uri` (a path under the web origin, a media URL as it is) and an
 * emoji passes through; an index entry carries only its named fields, with the
 * optional ones absent rather than undefined. And the tolerant shell parse
 * copied from `packages/miniapp/src/protocol/manifest.ts` in skkuverse-miniapp
 * (parseShellFields says why it is a copy): a bad value is dropped, a hex
 * background is upper-cased, and an unknown key never passes.
 */
import { parseShellFields, resolveLogo, toIndexEntry } from "./miniapps.mapper";
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

describe("parseShellFields", () => {
  it("returns {} for anything that is not a plain object", () => {
    // Act & Assert
    for (const value of [null, undefined, "x", 1, true, [], ["bar", "top"]]) {
      expect(parseShellFields(value)).toEqual({});
    }
  });

  it.each([
    ["top"],
    ["bottom"],
    ["none"],
  ])("accepts bar %j", (bar) => {
    // Act & Assert
    expect(parseShellFields({ bar })).toEqual({ bar });
  });

  it.each([["hide"], ["TOP"], [1], [null]])("drops an invalid bar %j", (bar) => {
    // Act & Assert
    expect(parseShellFields({ bar })).toEqual({});
  });

  it.each([["opaque"], ["overlay"]])("accepts header %j", (header) => {
    // Act & Assert
    expect(parseShellFields({ header })).toEqual({ header });
  });

  it.each([["sideways"], ["OPAQUE"], [1], [null]])("drops an invalid header %j", (header) => {
    // Act & Assert
    expect(parseShellFields({ header })).toEqual({});
  });

  it.each([["dark"], ["light"]])("accepts statusBar %j", (statusBar) => {
    // Act & Assert
    expect(parseShellFields({ statusBar })).toEqual({ statusBar });
  });

  it.each([["gray"], ["DARK"], [1], [null]])("drops an invalid statusBar %j", (statusBar) => {
    // Act & Assert
    expect(parseShellFields({ statusBar })).toEqual({});
  });

  it("accepts a lowercase hex background and upper-cases it", () => {
    // Act & Assert
    expect(parseShellFields({ background: "#0a0b0c" })).toEqual({ background: "#0A0B0C" });
  });

  it.each([["#FFF"], ["FFFFFF"], ["#GGGGGG"], [123456], [null]])(
    "drops an invalid background %j",
    (background) => {
      // Act & Assert
      expect(parseShellFields({ background })).toEqual({});
    },
  );

  it("keeps only the four known keys, dropping everything else", () => {
    // Act & Assert
    expect(
      parseShellFields({ bar: "top", extra: "nope", another: 1 }),
    ).toEqual({ bar: "top" });
  });

  it("reads every field at once", () => {
    // Act & Assert
    expect(
      parseShellFields({ bar: "none", header: "overlay", statusBar: "light", background: "#112233" }),
    ).toEqual({ bar: "none", header: "overlay", statusBar: "light", background: "#112233" });
  });
});
