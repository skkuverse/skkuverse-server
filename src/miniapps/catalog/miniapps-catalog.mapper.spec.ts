/**
 * Unit tests for the tolerant shell-config parser copied from
 * `packages/miniapp/src/protocol/manifest.ts` in skkuverse-miniapp (see
 * parseShellFields in miniapps-catalog.mapper.ts for why it is a copy rather
 * than an import), and the detail response it shapes. These vectors mirror the `manifest` describe block in that
 * package's `test/protocol.test.ts`, adapted to this file's narrower surface
 * (no `parseShellPatch`/`shell.set` — the server only ever reads a whole
 * manifest, never a runtime patch).
 */
import type { MiniAppDetailRaw } from "../miniapps.schema";
import type { ShellConfig } from "../miniapps.wire";
import { DEFAULT_SHELL } from "./miniapps-catalog.constants";
import { mergeShell, parseManifest, parseShellFields, toDetailResponse } from "./miniapps-catalog.mapper";

describe("parseManifest", () => {
  it("fills every field from DEFAULT_SHELL when there is nothing to read", () => {
    // Act & Assert
    expect(parseManifest(null)).toEqual({ shell: DEFAULT_SHELL });
    expect(parseManifest(undefined)).toEqual({ shell: DEFAULT_SHELL });
    expect(parseManifest("not an object")).toEqual({ shell: DEFAULT_SHELL });
    expect(parseManifest({})).toEqual({ shell: DEFAULT_SHELL });
  });

  it("keeps valid fields and drops invalid ones, upper-casing a valid hex background", () => {
    // Act & Assert
    expect(
      parseManifest({
        shell: { bar: "top", header: "sideways", statusBar: "light", background: "#0a0b0c", x: 1 },
      }),
    ).toEqual({ shell: { ...DEFAULT_SHELL, bar: "top", statusBar: "light", background: "#0A0B0C" } });
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

describe("mergeShell", () => {
  it("replaces only the fields `over` sets", () => {
    // Arrange
    const base: ShellConfig = DEFAULT_SHELL;

    // Act & Assert
    expect(mergeShell(base, { bar: "top" })).toEqual({ ...DEFAULT_SHELL, bar: "top" });
  });

  it("with {} returns the base unchanged", () => {
    // Act & Assert
    expect(mergeShell(DEFAULT_SHELL, {})).toEqual(DEFAULT_SHELL);
  });

  it("composes: default < registry < manifest, three-tier precedence", () => {
    // Arrange
    const registryFields = { bar: "top" as const };
    const manifestFields = { bar: "none" as const, background: "#000000" };
    const merged = mergeShell(mergeShell(DEFAULT_SHELL, registryFields), manifestFields);

    // Act & Assert
    // manifest wins where both set a field...
    expect(merged.bar).toBe("none");
    expect(merged.background).toBe("#000000");
    // ...and registry/default still supply what manifest and registry leave unset.
    expect(merged.header).toBe(DEFAULT_SHELL.header);
    expect(merged.statusBar).toBe(DEFAULT_SHELL.statusBar);
  });

  it("registry wins over default when manifest sets nothing", () => {
    // Arrange
    const registryFields = { bar: "top" as const };
    const merged = mergeShell(mergeShell(DEFAULT_SHELL, registryFields), {});

    // Act & Assert
    expect(merged).toEqual({ ...DEFAULT_SHELL, bar: "top" });
  });
});

describe("toDetailResponse", () => {
  const detail: MiniAppDetailRaw = {
    version: 1,
    id: "a",
    startUrl: "https://a.test/",
    verified: true,
    relatedLinks: [],
  };

  it("serves the registry detail with the complete default shell when neither the registry nor a manifest sets one", () => {
    // Act & Assert
    expect(toDetailResponse(detail, {})).toEqual({ ...detail, shell: DEFAULT_SHELL });
  });

  it("puts the manifest's fields over the registry's, upper-casing the registry's background", () => {
    // Act
    const response = toDetailResponse({ ...detail, shell: { bar: "top", background: "#0a0b0c" } }, { bar: "none" });

    // Assert
    expect(response.shell).toEqual({ ...DEFAULT_SHELL, bar: "none", background: "#0A0B0C" });
  });

  it("keeps the registry detail's key order, with shell last when the registry sets none", () => {
    // Act & Assert
    expect(Object.keys(toDetailResponse(detail, {}))).toEqual(["version", "id", "startUrl", "verified", "relatedLinks", "shell"]);
  });
});
