/**
 * The registry's wire shapes. What it guards: both image spellings leave as one
 * absolute `uri` (a path under the web origin, a media URL as it is) and an
 * emoji passes through; an index entry carries only its named fields, with the
 * optional ones absent rather than undefined. And the tolerant shell parse
 * copied from `packages/miniapp/src/protocol/manifest.ts` in skkuverse-miniapp
 * (parseShellFields says why it is a copy): a bad value is dropped, a hex
 * background is upper-cased, and an unknown key never passes.
 *
 * toMiniAppRegistry, the frozen snapshot every reader takes of one registry
 * revision: the index in `order` with both
 * logos resolved under the web origin it is given, each detail by its id, and the
 * lookups every reader asks of it (isRegistered, detailOf, a sender's credentials and the
 * target grammar). It is pure and reads no config, so the data tool builds the same
 * snapshot.
 */
import { fixtureRegistry } from "../../__tests__/helpers/miniapps/registry-fixture";
import { WEB_ORIGIN } from "../infra/origins";
import { parseShellFields, resolveLogo, toIndexEntry, toMiniAppRegistry } from "./miniapps.mapper";
import { newSigningKey } from "../../__tests__/helpers/miniapps/signing-keys";
import { checkedRegistry, type MiniAppIndexEntryRaw } from "./miniapps.schema";

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

describe("toMiniAppRegistry", () => {
  const FIXTURE_IDS = ["eskara-2026", "inja", "timetable", "playlist", "mukja", "booth-box", "hssc", "nsc", "skkuw", "skkuzine"];
  const snapshot = () => toMiniAppRegistry(checkedRegistry.parse(fixtureRegistry()), 7, WEB_ORIGIN);

  it("carries the revision it was read at and the index's version", () => {
    // Act
    const registry = snapshot();

    // Assert
    expect({ revision: registry.revision, version: registry.version }).toEqual({ revision: 7, version: 1 });
  });

  it("serves the index in ascending order, not the stored order", () => {
    // Act
    const ids = snapshot().indexEntries.map((entry) => entry.id);

    // Assert
    expect(ids).toEqual(FIXTURE_IDS);
  });

  it("resolves both logos of each entry, a path under the web origin and an emoji as it is", () => {
    // Act
    const hssc = snapshot().indexEntries.find((entry) => entry.id === "hssc");
    const inja = snapshot().indexEntries.find((entry) => entry.id === "inja");

    // Assert
    expect(hssc).toEqual({
      id: "hssc",
      name: "인사캠 총학생회",
      shortName: "인사캠 총학",
      order: 10,
      homeLogo: { kind: "remote", uri: "https://skkuverse.com/miniapps/hssc.png" },
      shellLogo: { kind: "remote", uri: "https://skkuverse.com/miniapps/hssc.png" },
      hidden: true,
    });
    expect(inja?.shellLogo).toEqual({ kind: "emoji", emoji: "🚌" });
  });

  it("is frozen, its index, each entry and each detail", () => {
    // Act
    const registry = snapshot();

    // Assert
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.indexEntries)).toBe(true);
    expect(registry.indexEntries.every((entry) => Object.isFrozen(entry))).toBe(true);
    expect(Object.isFrozen(registry.detailOf("skkuzine"))).toBe(true);
  });

  it("registers exactly the fixture's ids", () => {
    // Act
    const registry = snapshot();

    // Assert
    expect(FIXTURE_IDS.every((id) => registry.isRegistered(id))).toBe(true);
    expect(registry.isRegistered("no-such-app")).toBe(false);
    expect(registry.isRegistered("toString")).toBe(false);
  });

  it("answers each id's detail as stored, and nothing for an unknown id", () => {
    // Act
    const registry = snapshot();

    // Assert
    expect(registry.detailOf("skkuzine")).toEqual(fixtureRegistry().details.skkuzine);
    expect(registry.detailOf("no-such-app")).toBeUndefined();
  });

  // WHY: no registry entry carries a status, scopes or signing keys until 2A-3 adds them (docs/decisions/0023-perimeter-ports.md, "Changes during implementation").
  it("answers a sender with no status and no scopes as pending, with no scopes and no signing keys, and an unknown id with null", () => {
    // Act
    const registry = snapshot();

    // Assert
    expect(registry.detailOf("mukja")).not.toHaveProperty("status");
    expect(registry.detailOf("mukja")).not.toHaveProperty("scopes");
    expect(registry.senderCredentialsOf("mukja")).toEqual({ status: "pending", scopes: [], signingKeys: [] });
    expect(registry.senderCredentialsOf("no-such-app")).toBeNull();
  });

  it("accepts a target naming a registered mini app", () => {
    // Act & Assert
    expect(snapshot().isKnownMiniAppTarget("eskara-2026/eskara/wristband")).toBe(true);
  });

  it("refuses a well-formed target naming nothing registered, and a malformed one", () => {
    // Act & Assert
    expect(snapshot().isKnownMiniAppTarget("no-such-app/x")).toBe(false);
    expect(snapshot().isKnownMiniAppTarget("eskara-2026//evil.com/x")).toBe(false);
  });

  it("parses a target with the grammar, whether or not it is registered", () => {
    // Act & Assert
    expect(snapshot().parseTarget("eskara-2026/eskara/wristband")).toEqual({ id: "eskara-2026", path: "/eskara/wristband" });
    expect(snapshot().parseTarget("no-such-app")).toEqual({ id: "no-such-app" });
    expect(snapshot().parseTarget(42)).toBeNull();
  });

  it("counts one emoji in graphemes", () => {
    // Act & Assert
    expect(snapshot().isSingleEmoji("👩‍🍳")).toBe(true);
    expect(snapshot().isSingleEmoji("🍢🍗")).toBe(false);
  });
});

describe("toMiniAppRegistry sender credentials", () => {
  const { keyId, publicKey } = newSigningKey();
  const SIGNING_KEY = { keyId, publicKey };
  const registryWith = (credentials: Record<string, unknown>) => {
    const raw = fixtureRegistry();
    raw.details.mukja = { ...raw.details.mukja, ...credentials };
    return toMiniAppRegistry(checkedRegistry.parse(raw), 7, WEB_ORIGIN);
  };

  it("answers a sender with the status, scopes and signing keys its entry carries", () => {
    // Act
    const registry = registryWith({ status: "active", scopes: ["push.send"], signingKeys: [SIGNING_KEY] });

    // Assert
    expect(registry.senderCredentialsOf("mukja")).toEqual({ status: "active", scopes: ["push.send"], signingKeys: [SIGNING_KEY] });
    expect(registry.senderCredentialsOf("hssc")).toEqual({ status: "pending", scopes: [], signingKeys: [] });
  });

  it("answers a sender that sets only its status with no scopes and no signing keys", () => {
    // Act & Assert
    expect(registryWith({ status: "suspended" }).senderCredentialsOf("mukja")).toEqual({ status: "suspended", scopes: [], signingKeys: [] });
  });
});
