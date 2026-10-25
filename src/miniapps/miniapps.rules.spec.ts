/**
 * A mini-app target names a registered mini app (the grammar's own cases are
 * src/shared/miniapp-target.util.spec.ts). Also the two checks the registry
 * schema refines with: one emoji per logo,
 * counted in graphemes, and a startUrl on the web view that addresses a page.
 * And the one 404 both flows answer an unregistered id with.
 *
 * toRegistryIssues, the push check of who may start where (ADR 0013, D2):
 * each first-party origin is the startUrl origin of exactly the
 * mini app src/infra/origins.ts names for it, and a startUrl on a skkuverse.com
 * host is a first-party origin or the web view; a third party's start page is
 * its own business.
 */
import { fixtureRegistry } from "../../__tests__/helpers/miniapps/registry-fixture";
import { MINIAPP_ID_BY_FIRST_PARTY_ORIGIN, WEB_ORIGIN } from "../infra/origins";
import { WEBVIEW_ORIGIN } from "../shared/webview-origin.constants";
import { toMiniAppRegistry } from "./miniapps.mapper";
import { isKnownMiniAppTarget, isServableStartUrl, isSingleEmoji, toMiniAppNotFound, toRegistryIssues } from "./miniapps.rules";
import { checkedRegistry } from "./miniapps.schema";

describe("isKnownMiniAppTarget", () => {
  const registry = toMiniAppRegistry(checkedRegistry.parse(fixtureRegistry()), 1, WEB_ORIGIN);

  it("accepts a target naming a registered mini app", () => {
    // Act & Assert
    expect(isKnownMiniAppTarget("eskara-2026/eskara/wristband", registry.detailsById)).toBe(true);
  });

  it("refuses a well-formed target naming nothing registered", () => {
    // Act & Assert
    expect(isKnownMiniAppTarget("no-such-app/x", registry.detailsById)).toBe(false);
  });
});

describe("isSingleEmoji", () => {
  it.each([
    ["one pictograph", "🍢", true],
    ["a pictograph with a variation selector", "🌶️", true],
    ["a joined sequence", "👩‍🍳", true],
    ["two pictographs", "🍢🍗", false],
    ["a letter", "a", false],
    ["an empty string", "", false],
  ])("%s → %s", (_label, value, expected) => {
    // Act & Assert
    expect(isSingleEmoji(value)).toBe(expected);
  });
});

describe("isServableStartUrl", () => {
  it.each([
    ["a page on the web view", "https://webview.skkuverse.com/eskara", true],
    ["the web view's bare root", "https://webview.skkuverse.com/", false],
    ["a fragment route on the web view", "https://webview.skkuverse.com/#/eskara", false],
    ["a third party's bare root", "https://www.skkuw.com/", true],
    ["a third party's fragment", "https://example.com/#/section", true],
  ])("%s → %s", (_label, startUrl, expected) => {
    // Act & Assert
    expect(isServableStartUrl(startUrl)).toBe(expected);
  });
});

describe("toMiniAppNotFound", () => {
  it("is the 404 MINIAPP_NOT_FOUND naming the id", () => {
    // Act
    const error = toMiniAppNotFound("no-such-app");

    // Assert
    expect({ code: error.code, message: error.message, status: error.httpStatus }).toEqual({
      code: "MINIAPP_NOT_FOUND",
      message: "Unknown mini-app id: no-such-app",
      status: 404,
    });
  });
});

describe("toRegistryIssues", () => {
  const SITE = { owners: MINIAPP_ID_BY_FIRST_PARTY_ORIGIN, webviewOrigin: WEBVIEW_ORIGIN };

  /** The fixture with each named detail's startUrl replaced, parsed as a push parses it. */
  function withStartUrls(startUrls: Readonly<Record<string, string>>) {
    const raw = fixtureRegistry();
    for (const [id, startUrl] of Object.entries(startUrls)) raw.details[id] = { ...raw.details[id], startUrl };
    return checkedRegistry.parse(raw);
  }

  /** A registry of mini apps keyed by id, each with only the startUrl the rule reads. */
  const startingAt = (startUrls: Readonly<Record<string, string>>) => ({
    details: Object.fromEntries(Object.entries(startUrls).map(([id, startUrl]) => [id, { startUrl }])),
  });

  it("finds nothing in the fixture, whose four third-party start pages pass", () => {
    // Act & Assert
    expect(toRegistryIssues(checkedRegistry.parse(fixtureRegistry()), SITE)).toEqual([]);
  });

  it("refuses an owner the registry does not hold, at details", () => {
    // Arrange
    const raw = fixtureRegistry();
    delete raw.details.inja;
    raw.index.miniApps = raw.index.miniApps.filter((entry) => entry.id !== "inja");

    // Act
    const issues = toRegistryIssues(checkedRegistry.parse(raw), SITE);

    // Assert
    expect(issues).toEqual([{ path: ["details"], message: expect.stringMatching(/https:\/\/inja\.mini\.skkuverse\.com.*"inja"/) }]);
  });

  it("refuses an owner moved to another mini app, at both details' startUrl", () => {
    // Arrange
    const registryFile = withStartUrls({ mukja: "https://www.skkuw.com/mukja", playlist: "https://mukja.mini.skkuverse.com/" });

    // Act
    const paths = toRegistryIssues(registryFile, SITE).map((issue) => issue.path.join("."));

    // Assert
    expect(new Set(paths)).toEqual(new Set(["details.mukja.startUrl", "details.playlist.startUrl"]));
  });

  it("refuses a second mini app on an owned origin, at its startUrl, naming the owner", () => {
    // Arrange
    const registryFile = withStartUrls({ skkuw: "https://booth-box.mini.skkuverse.com/elsewhere" });

    // Act
    const issues = toRegistryIssues(registryFile, SITE);

    // Assert
    expect(issues).toEqual([{ path: ["details", "skkuw", "startUrl"], message: expect.stringContaining('"booth-box"') }]);
  });

  it.each([
    ["an unlisted mini-app host", "https://wave-run.mini.skkuverse.com/"],
    ["the apex host", "https://skkuverse.com/wave-run"],
    ["a listed host over plain http", "http://mukja.mini.skkuverse.com/"],
    ["an unlisted mini-app host written with a trailing dot", "https://wave.mini.skkuverse.com./"],
    ["the apex host written with a trailing dot", "https://skkuverse.com./"],
  ])("refuses a skkuverse.com start page on %s, at its startUrl", (_label, startUrl) => {
    // Act
    const issues = toRegistryIssues(startingAt({ "wave-run": startUrl }), { owners: {}, webviewOrigin: WEBVIEW_ORIGIN });

    // Assert
    expect(issues).toEqual([{ path: ["details", "wave-run", "startUrl"], message: expect.any(String) }]);
  });

  it("refuses a second mini app on an owned origin written with a trailing dot, at its startUrl, naming the owner", () => {
    // Arrange
    // WHY: DNS resolves `mukja.mini.skkuverse.com.` to the owner's host, so the dot must not hide whose origin it is.
    const registryFile = withStartUrls({ skkuw: "https://mukja.mini.skkuverse.com./x" });

    // Act
    const issues = toRegistryIssues(registryFile, SITE);

    // Assert
    expect(issues).toEqual([{ path: ["details", "skkuw", "startUrl"], message: expect.stringContaining('"mukja"') }]);
  });

  it.each([
    ["the web view", "https://webview.skkuverse.com/eskara"],
    ["a third party", "https://www.skkuw.com/"],
    ["a third party whose host only ends in the name", "https://notskkuverse.com/"],
  ])("passes a start page on %s", (_label, startUrl) => {
    // Act & Assert
    expect(toRegistryIssues(startingAt({ "wave-run": startUrl }), { owners: {}, webviewOrigin: WEBVIEW_ORIGIN })).toEqual([]);
  });

  describe("the owner check that toOwnerByOrigin ran at boot", () => {
    const OWNERS = { "https://a.test": "a" };

    it("passes when each owned origin is its owner's startUrl origin alone", () => {
      // Act & Assert
      expect(toRegistryIssues(startingAt({ a: "https://a.test/x", b: "https://b.test/" }), { owners: OWNERS, webviewOrigin: WEBVIEW_ORIGIN })).toEqual([]);
    });

    it("refuses two mini apps starting on one owned origin, at the one that does not own it", () => {
      // Act
      const issues = toRegistryIssues(startingAt({ a: "https://a.test/x", b: "https://a.test/y" }), { owners: OWNERS, webviewOrigin: WEBVIEW_ORIGIN });

      // Assert
      expect(issues.map((issue) => issue.path)).toEqual([["details", "b", "startUrl"]]);
    });

    it("refuses an owned origin no mini app starts on, at the owner's startUrl", () => {
      // Act
      const issues = toRegistryIssues(startingAt({ a: "https://b.test/" }), { owners: OWNERS, webviewOrigin: WEBVIEW_ORIGIN });

      // Assert
      expect(issues.map((issue) => issue.path)).toEqual([["details", "a", "startUrl"]]);
    });
  });
});
