/**
 * Two kinds of path that fail only outside the test run:
 *
 *   - assets: tsc emits only .js, so every JSON file under src/ that the code
 *     reads at runtime reaches dist/ only through scripts/copy-build-assets.js.
 *     A missing entry boots fine locally and crashes in production. Every JSON
 *     file under src/ must be listed there, every listed source must exist,
 *     and every literal `path.join(__dirname, "...json")` must name a listed
 *     file.
 *   - docs: a `src/...` path cited in docs/, CLAUDE.md or .claude/rules/ that
 *     no longer exists sends a reader, or an agent, to code that is gone.
 *     docs/archive/ is exempt: it is a snapshot of how things were. The other
 *     way round, a comment in src/ that cites a `docs/...md` path points a
 *     reader at a rationale (ADR 0010, D10), so that file must exist. A
 *     pointer may name a section as well: `docs/x.md (Section)`,
 *     `docs/x.md ("Section")`, `docs/x.md, "Section"`, `docs/x.md §2` or
 *     `docs/x.md#anchor`. The doc must have that heading: its exact text, or,
 *     for a numbered id (`D1`, `2`, `6.2`), a heading that opens with it
 *     (`D1. Layers`, `2. places`, `6.2 The window`). Sections are read in
 *     src/ comments and in every line of scripts/, whose JSON strings cite
 *     docs too.
 *   - scripts: a `src/...` path cited in scripts/ (code, comments, a data
 *     file's `_about`) that no longer exists, the same as docs. scripts/archive/
 *     is exempt like docs/archive/.
 */
import fs from "fs";
import path from "path";
import { commentLines, commentsOf } from "../helpers/architecture/comments";
import { parseDoc } from "../helpers/architecture/module-docs";
import { expectAllowlisted, ROOT } from "../helpers/architecture/ratchet";
import { filesUnder, readSource, sourceFiles } from "../helpers/architecture/tree";

/** `src/...` sources listed in copy-build-assets.js, with their destinations. */
export function listedAssets(script: string): Map<string, string> {
  // A commented-out entry is not copied.
  const code = script.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const pairs = [...code.matchAll(/\[\s*"(src\/[^"]+)",\s*"([^"]+)",?\s*\]/g)];
  return new Map(pairs.map((m) => [m[1]!, m[2]!]));
}

/** JSON files named by `path.join(__dirname, "<literal>", ...)` with literal arguments only. */
export function literalJsonReads(file: string, source: string): string[] {
  const dir = path.posix.dirname(file);
  return [...source.matchAll(/\bjoin\(\s*__dirname\s*((?:,\s*"[^"]+"\s*)+)\)/g)]
    .map((m) => [...m[1]!.matchAll(/"([^"]+)"/g)].map((s) => s[1]!))
    .filter((segments) => segments.at(-1)!.endsWith(".json"))
    .map((segments) => path.posix.join(dir, ...segments));
}

const CITE = /src\/[\w./{},*<>@-]*/g;

/** Expands one `{a,b}` group per pass; `src/x/{a,b}.json` → two paths. */
function expandBraces(p: string): string[] {
  const m = p.match(/\{([^{}]*)\}/);
  if (!m) return [p];
  return m[1]!.split(",").flatMap((alt) => expandBraces(p.replace(m[0], alt)));
}

/**
 * The `src/...` paths a line cites. A path counts when it starts the token or
 * follows `../` (a relative link); `apps/mobile/src/...` or a URL is another
 * repo. Globs and `<placeholders>` are not paths.
 */
export function citedPaths(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(CITE)) {
    const before = line.slice(0, m.index);
    if (!/(?:^|[^\w/.-])(?:\.\.\/)*$/.test(before)) continue;
    const raw = m[0].replace(/[.,]+$/, "");
    if (/[*<>]/.test(raw)) continue;
    out.push(...expandBraces(raw));
  }
  return out;
}

/** The `docs/...md` paths a comment cites, anchors dropped. */
export function citedDocs(comment: string): string[] {
  return [...comment.matchAll(/(?:^|[^\w/.-])(docs\/[\w./-]+\.md)/g)].map((m) => m[1]!);
}

export interface CitedSection {
  doc: string;
  section: string;
  /** `#anchor`: matched against the GitHub slug of each heading. */
  isAnchor: boolean;
}

const SECTION_CITE =
  /(?:^|[^\w/.-])(docs\/[\w./-]+\.md)(?:#([\w-]+)|\s?\(\s*"?([^")]+?)"?\s*\)|,\s*"([^"]+)"|\s?§\s?(\d+(?:\.\d+)*))/g;

/** The doc sections a text cites, in the forms the docblock lists; a JSON-escaped quote reads as a quote. */
export function citedSections(text: string): CitedSection[] {
  return [...text.replace(/\\"/g, '"').matchAll(SECTION_CITE)].map((m) => ({
    doc: m[1]!,
    section: (m[2] ?? m[3] ?? m[4] ?? m[5]!).trim(),
    isAnchor: m[2] !== undefined,
  }));
}

const NUMBERED_ID = /^[A-Za-z]?\d+(?:\.\d+)*$/;

const slugOf = (heading: string): string =>
  heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");

/** Whether `headings` (their text, without the `#`s) hold the cited section. */
export function hasSection(headings: readonly string[], { section, isAnchor }: Pick<CitedSection, "section" | "isAnchor">): boolean {
  if (isAnchor) return headings.some((h) => slugOf(h) === section);
  const wanted = section.toLowerCase();
  const opensWithId = (h: string): boolean => NUMBERED_ID.test(section) && new RegExp(`^${section.replace(/\./g, "\\.")}(?:\\.|\\s)(?!\\d)`, "i").test(h);
  return headings.some((h) => h.trim().toLowerCase() === wanted || opensWithId(h.trim()));
}

/** `<file>: <doc> (<section>)` for each cited section the doc lacks; a missing doc is the other test's. */
function missingSections(file: string, texts: readonly string[]): string[] {
  return texts.flatMap(citedSections).flatMap((cite) => {
    if (!fs.existsSync(path.join(ROOT, cite.doc))) return [];
    const headings = parseDoc(readSource(cite.doc)).headings.map((h) => h.text);
    return hasSection(headings, cite) ? [] : [`${file}: ${cite.doc} (${cite.section})`];
  });
}

function scriptFiles(): string[] {
  return filesUnder("scripts").filter((f) => !f.startsWith("scripts/archive/") && /\.(?:js|json|py|sh|md)$/.test(f));
}

function docFiles(): string[] {
  return [
    ...filesUnder("docs").filter((f) => !f.startsWith("docs/archive/")),
    "CLAUDE.md",
    ...filesUnder(".claude/rules"),
  ].filter((f) => f.endsWith(".md"));
}

describe("path rules apply as specified", () => {
  it("reads the asset list", () => {
    const script = `const assets = [
      ["src/a/x.json", "dist/src/a/x.json"],
      [
        "src/b/y.json",
        "dist/src/b/y.json",
      ],
      // ["src/c/z.json", "dist/src/c/z.json"],
    ];`;
    expect([...listedAssets(script)]).toEqual([
      ["src/a/x.json", "dist/src/a/x.json"],
      ["src/b/y.json", "dist/src/b/y.json"],
    ]);
  });

  it("finds literal JSON reads and skips dynamic ones", () => {
    const source = [
      'fs.readFileSync(path.join(__dirname, "home-layout.json"), "utf8")',
      'readFileSync(join(__dirname, "config", "a.json"), "utf8")',
      "fs.readFileSync(path.join(__dirname, ...segments))",
      'path.join(__dirname, "config", fileName)',
    ].join("\n");
    expect(literalJsonReads("src/ui/home/home-layout.ts", source)).toEqual([
      "src/ui/home/home-layout.json",
      "src/ui/home/config/a.json",
    ]);
  });

  it.each([
    ["see `src/main.ts`.", ["src/main.ts"]],
    ["[link](../../src/infra/db.ts#L10)", ["src/infra/db.ts"]],
    ["`src/notices/{sources,categories}.json`", ["src/notices/sources.json", "src/notices/categories.json"]],
    ["src/infra/config.ts:42", ["src/infra/config.ts"]],
    ["`src/**/*.spec.ts` and `src/<module>/`", []],
    ["apps/mobile/src/features and https://x.dev/blob/main/src/a.ts", []],
  ])("cites %j as %j", (line, expected) => {
    expect(citedPaths(line)).toEqual(expected);
  });

  it.each([
    ["// Why: docs/decisions/0006-building-search-relevance-ranking.md.", ["docs/decisions/0006-building-search-relevance-ranking.md"]],
    ["/** See docs/explanation/map-architecture.md#campus-shapes */", ["docs/explanation/map-architecture.md"]],
    ["// apps/web/docs/x.md and map-architecture.md", []],
  ])("a comment %j cites %j", (comment, expected) => {
    expect(citedDocs(comment)).toEqual(expected);
  });
});

describe("section citations apply as specified", () => {
  it.each([
    ["// SEE: docs/explanation/map-architecture.md (Caching): an ops change", { doc: "docs/explanation/map-architecture.md", section: "Caching", isAnchor: false }],
    ['/** SEE: docs/explanation/map-architecture.md ("Campus shapes"): a layer */', { doc: "docs/explanation/map-architecture.md", section: "Campus shapes", isAnchor: false }],
    ['// field on buildings: docs/explanation/map-architecture.md, "Campus shapes".', { doc: "docs/explanation/map-architecture.md", section: "Campus shapes", isAnchor: false }],
    ["// SEE: docs/reference/event-places.md §2 for each field", { doc: "docs/reference/event-places.md", section: "2", isAnchor: false }],
    ['"_about": "docs/reference/map-overlays-api.md, \\"How to author\\""', { doc: "docs/reference/map-overlays-api.md", section: "How to author", isAnchor: false }],
    ["/** See docs/explanation/map-architecture.md#campus-shapes */", { doc: "docs/explanation/map-architecture.md", section: "campus-shapes", isAnchor: true }],
  ])("reads %j", (text, expected) => {
    // Act & Assert
    expect(citedSections(text)).toEqual([expected]);
  });

  it("reads no section from a bare pointer or a path that is not a doc", () => {
    // Act & Assert
    expect(citedSections("// SEE: docs/decisions/0006-x.md: why the tiers. And apps/docs/x.md (Y).")).toEqual([]);
  });

  const HEADINGS = ["Map Architecture", "Structure", "D1. Layers: Controller → Service", "2. `places` — one place", "5. Authoring", "5.1 The old keys", "6.2 The window — and the kill switch"];

  it.each([
    ["the exact text, ignoring case", "structure"],
    ["a heading with code spans", "2. `places` — one place"],
    ["a numbered id that opens a heading", "D1"],
    ["a section number", "2"],
    ["a subsection number", "6.2"],
    ["a section number whose subsections exist too", "5"],
  ])("finds %s", (_case, section) => {
    // Act & Assert
    expect(hasSection(HEADINGS, { section, isAnchor: false })).toBe(true);
  });

  it.each([
    ["a heading the doc lacks", "Caching"],
    ["a prefix that is not a numbered id", "Map"],
    ["a section number with no heading of its own", "6"],
    ["a subsection number that does not exist", "5.3"],
  ])("misses %s", (_case, section) => {
    // Act & Assert
    expect(hasSection(HEADINGS, { section, isAnchor: false })).toBe(false);
  });

  it("matches an anchor against each heading's slug", () => {
    // Act & Assert
    expect(hasSection(["Campus shapes", "6.2 The window"], { section: "campus-shapes", isAnchor: true })).toBe(true);
    expect(hasSection(["Campus shapes", "6.2 The window"], { section: "62-the-window", isAnchor: true })).toBe(true);
    expect(hasSection(["Campus shapes"], { section: "caching", isAnchor: true })).toBe(false);
  });
});

describe("JSON assets", () => {
  const listed = listedAssets(readSource("scripts/copy-build-assets.js"));

  it("every JSON file under src/ is copied by copy-build-assets.js, to the same path under dist/", () => {
    const json = filesUnder("src").filter((f) => f.endsWith(".json"));
    expectAllowlisted("assets-listed", [
      ...json.filter((f) => !listed.has(f)).map((f) => `${f}: not listed`),
      ...[...listed]
        .filter(([src, dest]) => dest !== `dist/${src}`)
        .map(([src, dest]) => `${src}: copied to ${dest}`),
      ...[...listed.keys()]
        .filter((src) => !fs.existsSync(path.join(ROOT, src)))
        .map((src) => `${src}: listed but missing`),
    ]);
  });

  it("every literal path.join(__dirname, ...json) names a listed file", () => {
    expectAllowlisted(
      "assets-read",
      sourceFiles().flatMap((f) =>
        literalJsonReads(f, readSource(f))
          .filter((json) => !listed.has(json))
          .map((json) => `${f}: ${json}`),
      ),
    );
  });
});

describe("docs", () => {
  it("cite only src/ paths that exist", () => {
    const stale = docFiles().flatMap((doc) =>
      readSource(doc)
        .split("\n")
        .flatMap(citedPaths)
        // A module specifier (`src/infra/db` in a jest.mock example) has no extension.
        .filter((p) => !fs.existsSync(path.join(ROOT, p)) && !fs.existsSync(path.join(ROOT, `${p}.ts`)))
        .map((p) => `${doc}: ${p}`),
    );
    expectAllowlisted("docs-paths", stale);
  });

  it("are cited from src/ comments and scripts/ only by sections they have", () => {
    // Arrange
    const fromSrc = sourceFiles().map((file) => [file, commentsOf(file, readSource(file)).map((c) => commentLines(c).join(" "))] as const);
    const fromScripts = scriptFiles().map((file) => [file, readSource(file).split("\n")] as const);

    // Act
    const missing = [...fromSrc, ...fromScripts].flatMap(([file, texts]) => missingSections(file, texts));

    // Assert
    expectAllowlisted("doc-sections", missing);
  });

  it("are cited from src/ comments only by paths that exist", () => {
    const stale = sourceFiles().flatMap((file) =>
      commentsOf(file, readSource(file))
        .flatMap((c) => citedDocs(c.raw))
        .filter((doc) => !fs.existsSync(path.join(ROOT, doc)))
        .map((doc) => `${file}: ${doc}`),
    );
    expectAllowlisted("src-docs-paths", stale);
  });
});

describe("scripts", () => {
  it("cite only src/ paths that exist", () => {
    // Act
    const stale = scriptFiles().flatMap((file) =>
      readSource(file)
        .split("\n")
        .flatMap(citedPaths)
        .filter((p) => !fs.existsSync(path.join(ROOT, p)) && !fs.existsSync(path.join(ROOT, `${p}.ts`)))
        .map((p) => `${file}: ${p}`),
    );

    // Assert
    expectAllowlisted("scripts-paths", stale);
  });
});
