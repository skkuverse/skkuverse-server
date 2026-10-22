/**
 * registryFile, the structure of the mini app registry. What it guards: the
 * fixture, revision 1 of the stored `miniapps` dataset, passes; a registry
 * missing either half fails; an index entry gets both logos, the absent one
 * taking the other's; a detail's shell keeps only the fields it sets; and a
 * key no level declares fails, at every object level.
 *
 * checkedRegistry, the `miniapps` dataset a push is checked against and a
 * read parses: every refusal the
 * old boot check made of the committed files is a refusal here at the path of
 * the value at fault, the cross-references between the index and the details
 * included, so `npm run data` can name it; a push lists zod's message with
 * that path, so no custom words are pinned. storedRegistry is the stored
 * document's revision and data.
 */
import type { z } from "zod";
import { fixtureRegistry } from "../../__tests__/helpers/miniapps/registry-fixture";
import { checkedRegistry, registryFile, storedRegistry } from "./miniapps.schema";

const DETAIL = { version: 1, id: "a", startUrl: "https://a.test/", verified: true, relatedLinks: [] };

describe("registryFile", () => {
  it("passes the fixture, revision 1 of the stored registry", () => {
    // Act & Assert
    expect(registryFile.safeParse(fixtureRegistry()).success).toBe(true);
  });

  it.each(Object.keys(registryFile.shape))("fails a registry missing %s", (field) => {
    // Arrange
    const missing: Record<string, unknown> = { ...fixtureRegistry() };
    delete missing[field];

    // Act & Assert
    expect(registryFile.safeParse(missing).success).toBe(false);
  });

  it("gives an entry with one logo that logo in both slots", () => {
    // Arrange
    const emoji = { kind: "emoji", emoji: "😋" };
    const raw = { index: { version: 1, miniApps: [{ id: "a", name: "A", order: 1, shellLogo: emoji }] }, details: { a: DETAIL } };

    // Act
    const [entry] = registryFile.parse(raw).index.miniApps;

    // Assert
    expect(entry).toMatchObject({ homeLogo: emoji, shellLogo: emoji });
  });

  it.each([
    ["an index entry", { index: { version: 1, miniApps: [{ id: "a", name: "A", order: 1, homeLogo: { kind: "emoji", emoji: "😋" }, extra: 1 }] }, details: {} }],
    ["a detail", { index: { version: 1, miniApps: [] }, details: { a: { ...DETAIL, extra: 1 } } }],
    ["a shell", { index: { version: 1, miniApps: [] }, details: { a: { ...DETAIL, shell: { bar: "top", extra: 1 } } } }],
    ["a related link", { index: { version: 1, miniApps: [] }, details: { a: { ...DETAIL, relatedLinks: [{ url: "https://a.test/", extra: 1 }] } } }],
    ["a notice banner", { index: { version: 1, miniApps: [] }, details: { a: { ...DETAIL, noticeBanner: { title: "t", subtitle: "s", extra: 1 } } } }],
  ])("fails an unknown key on %s", (_level, raw) => {
    // Act
    const parsed = registryFile.safeParse(raw);

    // Assert
    expect(parsed.error?.issues.map((issue) => issue.code)).toEqual(["unrecognized_keys"]);
  });

  it("keeps a detail's shell to the fields it sets", () => {
    // Arrange
    const raw = { index: { version: 1, miniApps: [] }, details: { a: { ...DETAIL, shell: { bar: "top" } } } };

    // Act & Assert
    expect(registryFile.parse(raw).details.a?.shell).toEqual({ bar: "top" });
  });
});

type Raw = { index: { version: number; miniApps: Array<Record<string, unknown>> }; details: Record<string, Record<string, unknown>> };

/** One registered mini app, `a`, with only what the schema requires. */
function minimal(entry: Record<string, unknown> = {}, detail: Record<string, unknown> = {}): Raw {
  return {
    index: { version: 1, miniApps: [{ id: "a", name: "A", order: 1, homeLogo: { kind: "remote", path: "/miniapps/a.png" }, ...entry }] },
    details: { a: { ...DETAIL, ...detail } },
  };
}

function issuesOf(raw: unknown): Array<{ path: PropertyKey[]; message: string; code: string }> {
  const parsed = checkedRegistry.safeParse(raw);
  return (parsed.error?.issues ?? []).map((issue: z.core.$ZodIssue) => ({ path: issue.path, message: issue.message, code: issue.code }));
}

const pathsOf = (raw: unknown): PropertyKey[][] => issuesOf(raw).map((issue) => issue.path);

const ENTRY = ["index", "miniApps", 0];
const DETAIL_A = ["details", "a"];

describe("checkedRegistry", () => {
  it("accepts the fixture, revision 1 of the stored registry", () => {
    // Act & Assert
    expect(issuesOf(fixtureRegistry())).toEqual([]);
  });

  it("accepts a well-formed registry of one mini app", () => {
    // Act & Assert
    expect(issuesOf(minimal())).toEqual([]);
  });

  it.each([
    ["the old single logo", "logo"],
    ["a misspelt homeLogo", "homelogo"],
  ])("refuses an unknown index key, %s, at its entry", (_label, key) => {
    // Act
    const issues = issuesOf(minimal({ [key]: { kind: "emoji", emoji: "😋" } }));

    // Assert
    expect(issues).toEqual([expect.objectContaining({ path: ENTRY, code: "unrecognized_keys", message: expect.stringContaining(key) })]);
  });

  it("refuses an unknown detail key at its detail", () => {
    // Act
    const issues = issuesOf(minimal({}, { extra: 1 }));

    // Assert
    expect(issues).toEqual([expect.objectContaining({ path: DETAIL_A, code: "unrecognized_keys", message: expect.stringContaining("extra") })]);
  });

  it("refuses an id that is not a slug at the entry's id", () => {
    // Arrange
    const raw = minimal({ id: "Bad_Slug" });
    raw.details = { Bad_Slug: { ...DETAIL, id: "Bad_Slug" } };

    // Act & Assert
    expect(pathsOf(raw)).toEqual([[...ENTRY, "id"]]);
  });

  it.each([
    ["an absolute remote path", { kind: "remote", path: "https://evil.com/a.png" }, "path"],
    ["a remote path that is not a string", { kind: "remote", path: ["/miniapps/a.png"] }, "path"],
    ["a media logo on another host", { kind: "media", url: "https://evil.com/a.jpg" }, "url"],
    ["a media logo on the web origin", { kind: "media", url: "https://skkuverse.com/miniapps/a.png" }, "url"],
    ["a media logo given as a path", { kind: "media", url: "/miniapps/a.png" }, "url"],
    ["an empty emoji", { kind: "emoji", emoji: "" }, "emoji"],
    ["a word for an emoji", { kind: "emoji", emoji: "ab" }, "emoji"],
    ["two emoji", { kind: "emoji", emoji: "🍢🍗" }, "emoji"],
    ["an emoticon", { kind: "emoji", emoji: ":)" }, "emoji"],
    ["an emoji and a letter", { kind: "emoji", emoji: "🍢a" }, "emoji"],
  ])("refuses %s at the logo's field", (_label, homeLogo, field) => {
    // Act & Assert
    expect(pathsOf(minimal({ homeLogo }))).toEqual([[...ENTRY, "homeLogo", field]]);
  });

  it.each([
    ["a media logo on the bucket", { kind: "media", url: "https://media.skkuverse.com/miniapps/a/logo-01234567.jpg" }],
    ["one pictograph", { kind: "emoji", emoji: "🍢" }],
    ["a pictograph with a variation selector", { kind: "emoji", emoji: "🌶️" }],
    ["a joined sequence", { kind: "emoji", emoji: "👩‍🍳" }],
  ])("accepts %s", (_label, homeLogo) => {
    // Act & Assert
    expect(issuesOf(minimal({ homeLogo }))).toEqual([]);
  });

  it.each([[null], [[]], ["😋"]])("refuses a logo that is not an object, %j, at the logo", (homeLogo) => {
    // Act & Assert
    expect(pathsOf(minimal({ homeLogo }))).toEqual([[...ENTRY, "homeLogo"]]);
  });

  it("checks shellLogo with the same rules as homeLogo", () => {
    // Act & Assert
    expect(pathsOf(minimal({ shellLogo: { kind: "media", url: "https://evil.com/a.jpg" } }))).toEqual([[...ENTRY, "shellLogo", "url"]]);
    expect(pathsOf(minimal({ shellLogo: { kind: "emoji", emoji: "🍢🍗" } }))).toEqual([[...ENTRY, "shellLogo", "emoji"]]);
  });

  it("refuses an entry with neither logo at the entry, naming it", () => {
    // Arrange
    const raw = minimal();
    delete raw.index.miniApps[0]!.homeLogo;

    // Act & Assert
    expect(issuesOf(raw)).toEqual([expect.objectContaining({ path: ENTRY, message: '"a" needs at least one of homeLogo or shellLogo' })]);
  });

  it("accepts an entry with only a shellLogo", () => {
    // Arrange
    const raw = minimal({ shellLogo: { kind: "emoji", emoji: "😋" } });
    delete raw.index.miniApps[0]!.homeLogo;

    // Act & Assert
    expect(issuesOf(raw)).toEqual([]);
  });

  it.each([[true], [false]])("accepts hidden %j", (hidden) => {
    // Act & Assert
    expect(issuesOf(minimal({ hidden }))).toEqual([]);
  });

  it.each([["true"], [1], [null]])("refuses a hidden that is not a boolean, %j, at hidden", (hidden) => {
    // Act & Assert
    expect(pathsOf(minimal({ hidden }))).toEqual([[...ENTRY, "hidden"]]);
  });

  it.each([
    ["a script URL", "javascript:alert(1)"],
    ["a fragment route on the web view", "https://webview.skkuverse.com/#/eskara"],
    ["a fragment after a path on the web view", "https://webview.skkuverse.com/eskara#/entry"],
    ["the web view's bare root", "https://webview.skkuverse.com/"],
  ])("refuses %s as a startUrl at startUrl", (_label, startUrl) => {
    // Act & Assert
    expect(pathsOf(minimal({}, { startUrl }))).toEqual([[...DETAIL_A, "startUrl"]]);
  });

  it.each([
    ["a page on the web view", "https://webview.skkuverse.com/eskara"],
    ["a third party's bare root", "https://www.skkuw.com/"],
    ["a third party's fragment", "https://example.com/#/section"],
  ])("accepts %s as a startUrl", (_label, startUrl) => {
    // Act & Assert
    expect(issuesOf(minimal({}, { startUrl }))).toEqual([]);
  });

  it.each([
    ["bar", ["left", "TOP", "hide", true, null]],
    ["header", ["sideways", "OPAQUE", 1, null]],
    ["statusBar", ["gray", "DARK", 1, null]],
    ["background", ["FFFFFF", "#FFF", "#GGGGGG", 123456, null]],
  ] as const)("refuses each bad shell %s at its field", (field, values) => {
    // Act & Assert
    for (const value of values) {
      expect(pathsOf(minimal({}, { shell: { [field]: value } }))).toEqual([[...DETAIL_A, "shell", field]]);
    }
  });

  it.each([
    ["bar", ["top", "bottom", "none"]],
    ["header", ["opaque", "overlay"]],
    ["statusBar", ["dark", "light"]],
    ["background", ["#FFFFFF", "#0a0b0c"]],
  ] as const)("accepts each shell %s the app reads", (field, values) => {
    // Act & Assert
    for (const value of values) {
      expect(issuesOf(minimal({}, { shell: { [field]: value } }))).toEqual([]);
    }
  });

  it("accepts every shell field together, and an empty shell", () => {
    // Act & Assert
    expect(issuesOf(minimal({}, { shell: { bar: "top", header: "overlay", statusBar: "light", background: "#112233" } }))).toEqual([]);
    expect(issuesOf(minimal({}, { shell: {} }))).toEqual([]);
  });

  it.each([["bottomBar"], ["backForward"], ["position"]])("refuses the unknown shell key %s at the shell", (key) => {
    // Act & Assert
    expect(issuesOf(minimal({}, { shell: { [key]: false } }))).toEqual([expect.objectContaining({ path: [...DETAIL_A, "shell"], code: "unrecognized_keys" })]);
  });

  it.each([[[]], [false], ["top"]])("refuses a shell that is not an object, %j, at the shell", (shell) => {
    // Act & Assert
    expect(pathsOf(minimal({}, { shell }))).toEqual([[...DETAIL_A, "shell"]]);
  });

  it("refuses a related link that is not http(s) at its url", () => {
    // Act & Assert
    expect(pathsOf(minimal({}, { relatedLinks: [{ url: "javascript:alert(1)" }] }))).toEqual([[...DETAIL_A, "relatedLinks", 0, "url"]]);
  });

  it("refuses an unknown related link key at the link, and a bad label at the label", () => {
    // Act & Assert
    expect(pathsOf(minimal({}, { relatedLinks: [{ lable: "typo", url: "https://x.test" }] }))).toEqual([[...DETAIL_A, "relatedLinks", 0]]);
    expect(pathsOf(minimal({}, { relatedLinks: [{ label: 5, url: "https://x.test" }] }))).toEqual([[...DETAIL_A, "relatedLinks", 0, "label"]]);
  });

  it("refuses an unknown notice banner key at the banner", () => {
    // Act & Assert
    expect(pathsOf(minimal({}, { noticeBanner: { title: "t", subtitle: "s", sutitle: "typo" } }))).toEqual([[...DETAIL_A, "noticeBanner"]]);
  });

  it("refuses a duplicate id at the second entry's id, naming it", () => {
    // Arrange
    const raw = minimal();
    raw.index.miniApps.push({ ...raw.index.miniApps[0]! });

    // Act & Assert
    expect(issuesOf(raw)).toEqual([expect.objectContaining({ path: ["index", "miniApps", 1, "id"], message: expect.stringContaining('"a"') })]);
  });

  it("refuses an index id without a detail at the entry's id, naming it", () => {
    // Arrange
    const raw = minimal();
    raw.index.miniApps.push({ id: "wave-run", name: "Wave Run", order: 2, homeLogo: { kind: "emoji", emoji: "🌊" } });

    // Act & Assert
    expect(issuesOf(raw)).toEqual([expect.objectContaining({ path: ["index", "miniApps", 1, "id"], message: expect.stringContaining('"wave-run"') })]);
  });

  it("refuses a detail without an index entry at the detail, naming it", () => {
    // Arrange
    const raw = minimal();
    raw.details.ghost = { ...DETAIL, id: "ghost" };

    // Act & Assert
    expect(issuesOf(raw)).toEqual([expect.objectContaining({ path: ["details", "ghost"], message: expect.stringContaining('"ghost"') })]);
  });

  it("refuses a detail whose id differs from its key at the detail's id", () => {
    // Act & Assert
    expect(issuesOf(minimal({}, { id: "b" }))).toEqual([expect.objectContaining({ path: [...DETAIL_A, "id"], message: expect.stringContaining('"b"') })]);
  });
});


describe("storedRegistry", () => {
  it("accepts the fixture stored as revision 1", () => {
    // Act & Assert
    expect(storedRegistry.safeParse({ revision: 1, data: fixtureRegistry() }).success).toBe(true);
  });

  it.each(Object.keys(storedRegistry.shape))("refuses a document missing %s", (field) => {
    // Arrange
    const stored: Record<string, unknown> = { revision: 1, data: fixtureRegistry() };
    delete stored[field];

    // Act & Assert
    expect(storedRegistry.safeParse(stored).success).toBe(false);
  });

  it.each([[0], [1.5], ["1"]])("refuses a revision that is not a positive integer, %j", (revision) => {
    // Act & Assert
    expect(storedRegistry.safeParse({ revision, data: fixtureRegistry() }).success).toBe(false);
  });

  it("refuses stored data that fails checkedRegistry", () => {
    // Act & Assert
    expect(storedRegistry.safeParse({ revision: 1, data: minimal({}, { id: "b" }) }).success).toBe(false);
  });
});
