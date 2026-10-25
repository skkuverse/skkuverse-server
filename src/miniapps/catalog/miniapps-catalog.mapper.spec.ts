/**
 * The manifest parse and the shell merge of a detail. parseManifest runs the
 * vectors of the `manifest` describe block in skkuverse-miniapp's
 * `test/protocol.test.ts` over the shell parse copied from
 * `packages/miniapp/src/protocol/manifest.ts` (parseShellFields in
 * src/miniapps/miniapps.mapper.ts, whose spec covers the parse field by field),
 * adapted to this file's narrower surface (no `parseShellPatch`/`shell.set`:
 * the server only ever reads a whole manifest, never a runtime patch). The
 * merge puts the defaults under the registry's fields, under the manifest's.
 */
import type { MiniAppDetailRaw } from "../miniapps.schema";
import type { ShellConfig } from "../miniapps.wire";
import { DEFAULT_SHELL } from "./miniapps-catalog.constants";
import { mergeShell, parseManifest, toDetailResponse } from "./miniapps-catalog.mapper";

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

  // WHY: a sender's status, scopes and keys are the push routes' business, never the app's.
  it("leaves the sender's status, scopes and signing keys out of the detail it serves", () => {
    // Arrange
    const sender: MiniAppDetailRaw = { ...detail, sender: { status: "active", scopes: ["push.send"], signingKeys: [{ keyId: "0123456789abcdef", publicKey: "k".repeat(43) }] } };

    // Act & Assert
    expect(toDetailResponse(sender, {})).toEqual({ ...detail, shell: DEFAULT_SHELL });
  });
});
