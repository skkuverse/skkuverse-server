/**
 * A comment in a shared layer names no feature (ADR 0010, D10); specs and __tests__/ are not checked.
 * WHY: a feature counts as a path segment (`building/`), a file (`building.module.ts`) or a class
 * (`BuildingSyncPoller`), never as a bare word, so "building number" or `map` stays allowed.
 */
import { CLASS_ROLES } from "../helpers/architecture/names";
import { SHARED_LAYERS, isSharedLayer } from "../helpers/architecture/ast";
import { commentBlocks, commentsOf, numberedKeys } from "../helpers/architecture/comments";
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { filesUnder, isNonSpecSource, readSource, sourceFiles } from "../helpers/architecture/tree";

const ROLE_SUFFIXES = [...CLASS_ROLES].map((r) => r[0]!.toUpperCase() + r.slice(1));

/** Top-level `src/<name>/` folders that hold `<name>.module.ts`, the shared layers left out. */
export function featuresOf(files: readonly string[]): string[] {
  const names = files.flatMap((f) => /^src\/([^/]+)\/\1\.module\.ts$/.exec(f)?.[1] ?? []);
  return names.filter((n) => !isSharedLayer(n)).sort();
}

function inSharedLayer(file: string): boolean {
  return SHARED_LAYERS.some((layer) => file.startsWith(`src/${layer}/`));
}

/** A PascalCase class whose name opens with the feature's words and ends in a class role. */
function namesFeatureClass(identifier: string, feature: string): boolean {
  const words = feature.replace(/-/g, "");
  const rest = identifier.slice(words.length);
  return (
    identifier.slice(0, words.length).toLowerCase() === words &&
    /^[A-Z]/.test(rest) &&
    ROLE_SUFFIXES.some((suffix) => identifier.endsWith(suffix))
  );
}

/** The feature references in one comment's text, in order. */
function featureReferences(text: string, features: readonly string[]): string[] {
  const found: Array<[number, string]> = [];
  for (const feature of features) {
    // Feature folder names are kebab-case, so they need no escaping.
    for (const m of text.matchAll(new RegExp(String.raw`(?<![\w-])(?:src\/)?${feature}\/`, "g"))) {
      found.push([m.index, m[0]]);
    }
    for (const m of text.matchAll(new RegExp(String.raw`(?<![\w/.-])${feature}(?:[.-][\w-]+)*\.(?:ts|json)\b`, "g"))) {
      found.push([m.index, m[0]]);
    }
    for (const m of text.matchAll(/\b[A-Z][A-Za-z0-9]*\b/g)) {
      if (namesFeatureClass(m[0], feature)) found.push([m.index, m[0]]);
    }
  }
  return found.sort((a, b) => a[0] - b[0]).map(([, ref]) => ref);
}

/** `<file>: <reference>` per feature a shared-layer comment names, `#n` on a repeat. */
export function sharedCommentViolations(file: string, source: string, features: readonly string[]): string[] {
  if (!isNonSpecSource(file) || !inSharedLayer(file)) return [];
  const refs = commentBlocks(commentsOf(file, source)).flatMap((b) => featureReferences(b.text.join(" "), features));
  return numberedKeys(file, refs);
}

describe("shared comment rule applies as specified", () => {
  const features = ["ad", "app-config", "building", "bus", "miniapps"];

  it("finds the features in src/<layer>/ folders that hold their own module file", () => {
    // Arrange
    const files = ["src/building/building.module.ts", "src/http/http.module.ts", "src/bus/types.ts", "src/x.ts"];

    // Act
    const found = featuresOf(files);

    // Assert
    expect(found).toEqual(["building"]);
  });

  it("flags a feature path, class or backticked name in a shared-layer comment", () => {
    // Arrange
    const source = [
      "// WHY: src/building/ reads it, and so does ../bus/cache.",
      "const a = 1;",
      "/** QUIRK(nest): BuildingSyncPoller and MiniAppsController need it, as app-config.types.ts says. */",
    ].join("\n");

    // Act
    const violations = sharedCommentViolations("src/infra/x.ts", source, features);

    // Assert
    expect(violations).toEqual([
      "src/infra/x.ts: src/building/",
      "src/infra/x.ts: bus/",
      "src/infra/x.ts: BuildingSyncPoller",
      "src/infra/x.ts: MiniAppsController",
      "src/infra/x.ts: app-config.types.ts",
    ]);
  });

  it("allows the words in prose, inside longer names and in code", () => {
    // Arrange
    const source = [
      "// WHY: the building number and the bus stop are SKKU's words, as in rebuilding/ or BusyLoop.",
      "// EVIDENCE: AddressService and Buildings are not feature classes; `map` is Array's.",
      "// SEE: docs/x.md, and scripts/lib/map-places-file.js is a script.",
      'const p = "src/building/x.ts";',
    ].join("\n");

    // Act
    const violations = sharedCommentViolations("src/http/x.ts", source, features);

    // Assert
    expect(violations).toEqual([]);
  });

  it("checks only the shared layers, and skips their specs", () => {
    // Arrange
    const source = "// WHY: src/building/ reads it.";

    // Act
    const checked = ["src/bus/x.ts", "src/shared/x.spec.ts", "__tests__/helpers/x.ts", "src/shared/x.ts"].map(
      (f) => sharedCommentViolations(f, source, features),
    );

    // Assert
    expect(checked).toEqual([[], [], [], ["src/shared/x.ts: src/building/"]]);
  });
});

describe("shared comments", () => {
  it("name no feature: a shared layer knows nothing about its callers", () => {
    // Arrange
    const features = featuresOf(filesUnder("src"));

    // Act
    const violations = sourceFiles().flatMap((f) => sharedCommentViolations(f, readSource(f), features));

    // Assert
    expect(features.length).toBeGreaterThan(5);
    expectAllowlisted("shared-comments", violations);
  });
});
