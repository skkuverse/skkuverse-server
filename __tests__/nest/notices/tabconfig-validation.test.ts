/**
 * src/notices/tabConfig.ts validates categories.json, sources.json and
 * exclude-reasons.json on import and exits the process on the first failure.
 * Under NODE_ENV=test it only logs, so each case loads a fresh copy with
 * NODE_ENV=production, one file replaced, and process.exit turned into a throw.
 */
import realFs from "fs";
import path from "path";

class Exit extends Error {}

function readReal(name: string): string {
  return realFs.readFileSync(
    path.join(__dirname, "../../../src/notices", name),
    "utf8",
  );
}

function loadWith(replace: Record<string, string>): {
  exitCode: unknown;
  fatal: jest.Mock;
} {
  const fatal = jest.fn();
  let exitCode: unknown;
  const exit = jest.spyOn(process, "exit").mockImplementation(((
    code?: number,
  ) => {
    exitCode = code;
    throw new Exit();
  }) as never);
  const prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    jest.isolateModules(() => {
      jest.doMock("../../../src/infra/logger", () => ({ fatal }));
      jest.doMock("fs", () => ({
        ...realFs,
        readFileSync: (file: string, enc: BufferEncoding) =>
          replace[path.basename(file)] ?? realFs.readFileSync(file, enc),
      }));
      require("../../../src/notices/tabConfig");
    });
  } catch (err) {
    if (!(err instanceof Exit)) throw err;
  } finally {
    process.env.NODE_ENV = prevEnv;
    exit.mockRestore();
  }
  return { exitCode, fatal };
}

function picker(mutate: (cat: Record<string, unknown>) => void): string {
  const cats = JSON.parse(readReal("categories.json")) as Array<
    Record<string, unknown>
  >;
  mutate(cats.find((c) => c.tabMode === "picker")!);
  return JSON.stringify(cats);
}

describe("tabConfig.ts fail-fast validation", () => {
  it("loads the committed JSON without exiting", () => {
    const { exitCode, fatal } = loadWith({});
    expect(exitCode).toBeUndefined();
    expect(fatal).not.toHaveBeenCalled();
  });

  it.each([
    ["categories.json is not JSON", { "categories.json": '[{"id": ' }, "Invalid JSON in categories.json"],
    ["sources.json is not an array", { "sources.json": '{"a": 1}' }, "sources.json must be a JSON array"],
    [
      "a picker tab names an unknown source",
      { "categories.json": picker((c) => (c.sourceIds as string[]).push("no-such-source")) },
      'sourceId "no-such-source" in sourceIds not found in sources.json',
    ],
    ["exclude-reasons.json is not JSON", { "exclude-reasons.json": '{"x": ' }, "Invalid JSON in exclude-reasons.json"],
    ["exclude-reasons.json is an array", { "exclude-reasons.json": "[]" }, "exclude-reasons.json must be a JSON object"],
    [
      "a source's excludeReason has no copy",
      { "exclude-reasons.json": "{}" },
      "with no entry in exclude-reasons.json",
    ],
  ])("exits 1 when %s", (_name, replace, message) => {
    const { exitCode, fatal } = loadWith(replace);
    expect(exitCode).toBe(1);
    expect(fatal).toHaveBeenCalledWith(
      { event: "notices.tabconfig.invalid" },
      expect.stringContaining(message),
    );
  });
});
