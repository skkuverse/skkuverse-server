/**
 * File and class names under src/ (ADR 0010, D4):
 *
 *   - suffix: `<name>.<role>.ts` with a role from the closed vocabulary below.
 *     `.spec` and `.generated` wrap a valid name (`foo.service.spec.ts`).
 *     `.util` is allowed only in src/shared/. Files in src/infra/ are named by
 *     the resource they wrap (`db.ts`, `logger.ts`) and need no role.
 *   - kebab-case: every dot-separated part of the name.
 *   - class name: an exported class in a file whose role is a class role is
 *     PascalCase(name) + PascalCase(role): `notice-dispatch.repository.ts`
 *     exports `NoticeDispatchRepository`. A `.error.ts` file may export several
 *     classes; each starts with PascalCase(name) and ends with `Error`.
 */
import ts from "typescript";
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { readSource, filesUnder } from "../helpers/architecture/tree";

const ROLES = new Set([
  "module",
  "controller",
  "service",
  "repository",
  "client",
  "poller",
  "rules",
  "mapper",
  "config",
  "schema",
  "types",
  "document",
  "constants",
  "error",
  "middleware",
  "filter",
  "interceptor",
  "pipe",
  "decorator",
  "util",
]);

const CLASS_ROLES = new Set([
  "module",
  "controller",
  "service",
  "repository",
  "client",
  "poller",
  "error",
  "middleware",
  "filter",
  "interceptor",
  "pipe",
]);

const EXEMPT = new Set([
  "src/main.ts",
  "src/instrument.ts",
  "src/app.module.ts",
  "src/types.d.ts",
  // Pinned by the umbrella repo's contract manifest (.contracts.lock.json).
  "src/notices/notices.topics.ts",
]);

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface ParsedName {
  /** Dot-separated parts without `.ts`, `.spec` and `.generated`. */
  parts: string[];
  dir: string;
}

function parse(file: string): ParsedName {
  const slash = file.lastIndexOf("/");
  let parts = file.slice(slash + 1).replace(/\.ts$/, "").split(".");
  if (parts.at(-1) === "spec") parts = parts.slice(0, -1);
  if (parts.at(-1) === "generated") parts = parts.slice(0, -1);
  return { parts, dir: file.slice(0, slash) };
}

const inInfra = (dir: string) => dir === "src/infra" || dir.startsWith("src/infra/");
const inShared = (dir: string) => dir === "src/shared" || dir.startsWith("src/shared/");

export function suffixViolation(file: string): boolean {
  if (EXEMPT.has(file)) return false;
  const { parts, dir } = parse(file);
  if (inInfra(dir) && parts.length === 1) return false;
  if (parts.length !== 2) return true;
  const role = parts[1]!;
  if (!ROLES.has(role)) return true;
  return role === "util" && !inShared(dir);
}

export function kebabViolation(file: string): boolean {
  if (EXEMPT.has(file)) return false;
  return !parse(file).parts.every((p) => KEBAB.test(p));
}

const pascal = (kebab: string) =>
  kebab
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");

function exportedClasses(source: string): string[] {
  const sf = ts.createSourceFile("x.ts", source, ts.ScriptTarget.ES2022, false);
  return sf.statements.flatMap((s) =>
    ts.isClassDeclaration(s) &&
    s.name &&
    s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      ? [s.name.text]
      : [],
  );
}

/** `<file>: <class>` for each exported class whose name does not match its file. */
export function classNameViolations(file: string, source: string): string[] {
  if (EXEMPT.has(file) || file.endsWith(".spec.ts")) return [];
  const { parts } = parse(file);
  if (parts.length !== 2 || !CLASS_ROLES.has(parts[1]!)) return [];
  const [base, role] = parts as [string, string];
  const ok =
    role === "error"
      ? (name: string) => name.startsWith(pascal(base)) && name.endsWith("Error")
      : (name: string) => name === pascal(base) + pascal(role);
  return exportedClasses(source)
    .filter((name) => !ok(name))
    .map((name) => `${file}: ${name}`);
}

describe("naming rules apply as specified", () => {
  it.each([
    "src/building/building.service.ts",
    "src/notices/notice-dispatch.repository.ts",
    "src/notices/notice.document.generated.ts",
    "src/building/building.service.spec.ts",
    "src/shared/regex.util.ts",
    "src/shared/regex.util.spec.ts",
    "src/infra/db.ts",
    "src/infra/db.spec.ts",
    "src/infra/nest-logger.ts",
    "src/main.ts",
    "src/notices/notices.topics.ts",
  ])("accepts the suffix of %s", (file) => {
    expect(suffixViolation(file)).toBe(false);
  });

  it.each([
    "src/building/foo.helper.ts",
    "src/building/building.data.ts",
    "src/building/types.ts",
    "src/notices/notices.dedup-key.ts",
    "src/building/foo.util.ts",
    "src/building/a.b.service.ts",
    "src/infra/foo.bar.ts",
  ])("rejects the suffix of %s", (file) => {
    expect(suffixViolation(file)).toBe(true);
  });

  it.each([
    ["src/infra/rateLimitKeys.ts", true],
    ["src/notices/tabConfig.ts", true],
    ["src/notices/notices.dedup-key.ts", false],
    ["src/map/map-layerset.config.ts", false],
  ])("kebab-case of %s violates: %s", (file, violates) => {
    expect(kebabViolation(file)).toBe(violates);
  });

  it("matches class names to file names", () => {
    expect(
      classNameViolations(
        "src/notices/notice-dispatch.repository.ts",
        "export class NoticeDispatchRepository {}\nclass Helper {}",
      ),
    ).toEqual([]);
    expect(
      classNameViolations("src/common/general-rate-limit.middleware.ts", "export class BusRateLimitMiddleware {}"),
    ).toEqual(["src/common/general-rate-limit.middleware.ts: BusRateLimitMiddleware"]);
    expect(
      classNameViolations(
        "src/bus/eta/directions.error.ts",
        "export class DirectionsQuotaError extends Error {}\nexport class Other {}",
      ),
    ).toEqual(["src/bus/eta/directions.error.ts: Other"]);
    expect(classNameViolations("src/building/building.types.ts", "export class Anything {}")).toEqual([]);
  });
});

describe("src/ file and class names", () => {
  const files = filesUnder("src").filter((f) => f.endsWith(".ts"));

  it("use a role from the suffix vocabulary", () => {
    expectAllowlisted("suffix", files.filter(suffixViolation));
  });

  it("are kebab-case", () => {
    expectAllowlisted("kebab-case", files.filter(kebabViolation));
  });

  it("name each exported class after its file", () => {
    expectAllowlisted(
      "class-name",
      files.flatMap((f) => classNameViolations(f, readSource(f))),
    );
  });
});
