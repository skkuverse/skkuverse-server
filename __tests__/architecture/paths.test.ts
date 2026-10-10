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
 *     reader at a rationale (ADR 0010, D10), so that file must exist.
 */
import fs from "fs";
import path from "path";
import { commentsOf } from "../helpers/architecture/comments";
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
