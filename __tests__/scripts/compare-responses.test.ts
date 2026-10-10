/**
 * scripts/compare-responses.js is the before/after check every refactor
 * deploy rests on: a diff that misses a change lets a contract break ship, and
 * one that flags live-data churn in shape mode trains people to ignore it.
 * Only the pure logic is tested here; the fetch loop needs the network.
 */
// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const {
  buildRecord,
  compareRecords,
  diffSnapshot,
  formatReport,
  parseArgs,
  parseUrlList,
  shapeOf,
} = require("../../scripts/compare-responses");

const JSON_TYPE = "application/json; charset=utf-8";

function record(body: unknown, headers: Record<string, string> = {}, status = 200) {
  return buildRecord({
    status,
    headers: new Headers({ "content-type": JSON_TYPE, etag: 'W/"1-a"', vary: "Accept-Language", ...headers }),
    text: JSON.stringify(body),
  });
}

const both = (expected: unknown, actual: unknown) => ({
  exact: compareRecords(record(expected), record(actual), "exact"),
  shape: compareRecords(record(expected), record(actual), "shape"),
});

describe("parseUrlList", () => {
  it("keeps paths in order and skips comments and blank lines", () => {
    const text = "# buildings\n/building/list\n\n  /building/list?campus=hssc  \r\n# end\n   \n/building/1\n";
    expect(parseUrlList(text)).toEqual(["/building/list", "/building/list?campus=hssc", "/building/1"]);
  });

  it.each([
    ["a full URL", "https://api.skkuverse.com/building/list", /not a path/],
    ["a protocol-relative path", "//evil.example/x", /not a path/],
    ["a path with a space", "/building/search?q=a b", /whitespace/],
    ["a duplicate", "/a\n/a", /listed twice/],
    ["nothing but comments", "# only\n\n", /no paths/],
  ])("rejects %s", (_name, text, error) => {
    expect(() => parseUrlList(text)).toThrow(error);
  });
});

describe("buildRecord", () => {
  it("keeps status, the four contract headers and the parsed JSON body", () => {
    const rec = buildRecord({
      status: 200,
      headers: new Headers({
        "content-type": JSON_TYPE,
        "cache-control": "public, max-age=60",
        etag: 'W/"2-b"',
        vary: "Accept-Language, Origin",
        "x-response-time": "12.3ms",
        "x-request-id": "abc",
      }),
      text: '{"data":[1]}',
    });
    expect(rec).toEqual({
      status: 200,
      headers: {
        "cache-control": "public, max-age=60",
        etag: 'W/"2-b"',
        vary: "Accept-Language, Origin",
        "content-type": JSON_TYPE,
      },
      bodyType: "json",
      body: { data: [1] },
    });
  });

  it("records an absent header as null and accepts a plain header object", () => {
    const rec = buildRecord({ status: 404, headers: { "Content-Type": "text/plain" }, text: "nope" });
    expect(rec.headers).toEqual({ "cache-control": null, etag: null, vary: null, "content-type": "text/plain" });
    expect(rec).toMatchObject({ bodyType: "text", body: "nope" });
  });

  it("keeps a JSON content-type with an unparseable body as text", () => {
    const rec = buildRecord({ status: 502, headers: { "content-type": "application/json" }, text: "<html>" });
    expect(rec).toMatchObject({ bodyType: "text", body: "<html>" });
  });

  it("parses +json content-types", () => {
    const rec = buildRecord({ status: 400, headers: { "content-type": "application/problem+json" }, text: "{}" });
    expect(rec.bodyType).toBe("json");
  });
});

describe("compareRecords", () => {
  const body = { meta: { lang: "ko" }, data: [{ id: 1, name: "a", tags: ["x"] }] };

  it("finds no difference between identical responses in either mode", () => {
    expect(both(body, structuredClone(body))).toEqual({ exact: [], shape: [] });
  });

  it("ignores key order", () => {
    expect(both({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual({ exact: [], shape: [] });
  });

  it("reports a changed value in exact mode only", () => {
    const changed = structuredClone(body);
    changed.data[0].name = "b";
    expect(both(body, changed)).toEqual({ exact: ['body.data[0].name: "a" -> "b"'], shape: [] });
  });

  it("reports a changed type in both modes", () => {
    const changed = { ...body, data: [{ id: "1", name: "a", tags: ["x"] }] };
    const { exact, shape } = both(body, changed);
    expect(exact).toEqual(['body.data[0].id: number 1 -> string "1"']);
    expect(shape).toEqual(["body.data[].id: number -> string"]);
  });

  it("reports an added and a removed key in both modes", () => {
    const { exact, shape } = both({ a: 1, b: "x" }, { a: 1, c: true });
    expect(exact).toEqual(['body.b: key removed (was "x")', "body.c: key added (true)"]);
    expect(shape).toEqual(["body.b: key removed (was string)", "body.c: key added (boolean)"]);
  });

  it("treats a list with more items of the same shape as equal in shape mode only", () => {
    const more = { ...body, data: [...body.data, { id: 2, name: "b", tags: [] }, { id: 3, name: "c", tags: ["y", "z"] }] };
    const { exact, shape } = both(body, more);
    expect(exact).toContain("body.data: array length 1 -> 3");
    expect(shape).toEqual([]);
  });

  it("compares an array by the union of its items' shapes", () => {
    // One item has a key the others lack: the union still has it, so equal.
    expect(both({ l: [{ a: 1 }, { a: 2, b: "x" }] }, { l: [{ a: 3, b: "y" }] }).shape).toEqual([]);
    // A key no item has any more is a difference.
    expect(both({ l: [{ a: 1, b: "x" }] }, { l: [{ a: 2 }, { a: 3 }] }).shape).toEqual([
      "body.l[].b: key removed (was string)",
    ]);
    // Mixed item kinds are a union, compared as a set.
    expect(both({ l: [1, "a"] }, { l: ["b", 2, 3] }).shape).toEqual([]);
    expect(both({ l: [1, "a"] }, { l: [2] }).shape).toEqual(["body.l[]: number|string -> number"]);
  });

  it("reports an emptied list in shape mode", () => {
    expect(both({ l: [{ a: 1 }] }, { l: [] }).shape).toEqual(["body.l[]: object -> nothing (empty array)"]);
  });

  it("treats null as its own type", () => {
    const { exact, shape } = both({ v: { a: 1 } }, { v: null });
    expect(exact).toEqual(['body.v: object {"a":1} -> null']);
    expect(shape).toEqual(["body.v: object -> null"]);
    expect(both({ l: [{ s: "a" }] }, { l: [{ s: "a" }, { s: null }] }).shape).toEqual([
      "body.l[].s: string -> null|string",
    ]);
  });

  it("quotes keys that are not identifiers", () => {
    expect(both({ "a-b": 1 }, { "a-b": 2 }).exact).toEqual(['body["a-b"]: 1 -> 2']);
  });

  it("always compares status and the contract headers exactly", () => {
    const before = record(body);
    for (const mode of ["exact", "shape"]) {
      expect(compareRecords(before, record(body, {}, 404), mode)).toEqual(["status: 200 -> 404"]);
      expect(compareRecords(before, record(body, { "cache-control": "no-store" }), mode)).toEqual([
        'header cache-control: (absent) -> "no-store"',
      ]);
      expect(compareRecords(before, record(body, { vary: "Accept-Language, Origin" }), mode)).toEqual([
        'header vary: "Accept-Language" -> "Accept-Language, Origin"',
      ]);
      expect(compareRecords(before, record(body, { "content-type": "application/json" }), mode)).toEqual([
        'header content-type: "application/json; charset=utf-8" -> "application/json"',
      ]);
    }
  });

  it("compares the etag value in exact mode and only its presence in shape mode", () => {
    const before = record(body);
    const otherEtag = record(body, { etag: 'W/"9-z"' });
    expect(compareRecords(before, otherEtag, "exact")).toEqual([`header etag: "W/\\"1-a\\"" -> "W/\\"9-z\\""`]);
    expect(compareRecords(before, otherEtag, "shape")).toEqual([]);

    const noEtag = buildRecord({ status: 200, headers: { "content-type": JSON_TYPE, vary: "Accept-Language" }, text: "{}" });
    const withEtag = record({});
    expect(compareRecords(withEtag, noEtag, "shape")).toEqual(["header etag: present -> absent"]);
    expect(compareRecords(noEtag, withEtag, "shape")).toEqual(["header etag: absent -> present"]);
  });

  it("ignores X-Response-Time and every other unrecorded header", () => {
    const a = record(body, { "x-response-time": "1.0ms", "x-request-id": "a", "ratelimit-remaining": "41" });
    const b = record(body, { "x-response-time": "250.7ms", "x-request-id": "b", "ratelimit-remaining": "12" });
    expect(compareRecords(a, b, "exact")).toEqual([]);
  });

  it("reports a body that stopped being JSON", () => {
    const text = buildRecord({ status: 200, headers: { "content-type": JSON_TYPE }, text: "oops" });
    expect(compareRecords(record({}), text, "shape")).toContain("body: json -> text");
  });

  it("compares text bodies exactly in exact mode only", () => {
    const a = buildRecord({ status: 200, headers: { "content-type": "text/plain" }, text: "hello world" });
    const b = buildRecord({ status: 200, headers: { "content-type": "text/plain" }, text: "hello there" });
    expect(compareRecords(a, b, "exact")).toEqual(['body: text differs at char 6: "hello world" -> "hello there"']);
    expect(compareRecords(a, b, "shape")).toEqual([]);
  });

  it("rejects an unknown mode", () => {
    expect(() => compareRecords(record({}), record({}), "loose")).toThrow(/unknown mode/);
  });
});

describe("shapeOf", () => {
  it("unions object keys across array items", () => {
    expect(shapeOf([{ a: 1 }, { b: null }])).toEqual({
      array: { object: { a: { number: true }, b: { null: true } } },
    });
  });
});

describe("diffSnapshot + formatReport", () => {
  const snapshot = { version: 1, responses: { "/a": record({ x: 1 }), "/b": record({ y: [1] }) } };

  it("prints `no difference` when every URL matches", () => {
    const results = diffSnapshot(snapshot, { "/a": record({ x: 1 }), "/b": record({ y: [1] }) }, ["/a", "/b"], "exact");
    const report = formatReport(results, "exact");
    expect(report).toContain("ok    /a");
    expect(report).toContain("ok    /b");
    expect(report).toMatch(/no difference across 2 URL\(s\) \(exact mode\)\n$/);
  });

  it("lists each differing URL with its differences and flags paths missing from the snapshot", () => {
    const results = diffSnapshot(snapshot, { "/a": record({ x: 2 }), "/b": record({ y: [1] }), "/c": record({}) }, [
      "/a",
      "/b",
      "/c",
    ], "exact");
    expect(results).toEqual([
      { path: "/a", differences: ["body.x: 1 -> 2"] },
      { path: "/b", differences: [] },
      { path: "/c", differences: ["not in the snapshot (capture it first)"] },
    ]);
    const report = formatReport(results, "exact");
    expect(report).toContain("DIFF  /a\n        body.x: 1 -> 2\nok    /b\nDIFF  /c\n");
    expect(report).toMatch(/2 of 3 URL\(s\) differ \(exact mode\)\n$/);
    expect(report).not.toContain("no difference");
  });

  it("truncates a long list of differences per URL", () => {
    const report = formatReport([{ path: "/a", differences: ["1", "2", "3", "4"] }], "exact", 2);
    expect(report).toContain("        1\n        2\n        ... and 2 more\n");
  });
});

describe("parseArgs", () => {
  it("reads capture and diff flags with their defaults", () => {
    expect(parseArgs(["capture", "--base", "https://x", "--urls", "u.txt", "--out", "s.json"])).toEqual({
      command: "capture",
      force: false,
      base: "https://x",
      urls: "u.txt",
      out: "s.json",
      lang: "ko",
    });
    expect(parseArgs(["diff", "--against", "s.json", "--mode", "shape"])).toEqual({
      command: "diff",
      force: false,
      against: "s.json",
      mode: "shape",
    });
    expect(parseArgs(["diff", "--against", "s.json"]).mode).toBe("exact");
  });

  it.each([
    ["no command", [], /usage/],
    ["a missing required flag", ["capture", "--base", "https://x", "--urls", "u.txt"], /needs --out/],
    ["a flag of the other command", ["diff", "--against", "s.json", "--out", "x"], /unknown argument/],
    ["a flag without a value", ["diff", "--against"], /needs a value/],
    ["an unknown mode", ["diff", "--against", "s.json", "--mode", "loose"], /--mode must be/],
  ])("rejects %s", (_name, argv, error) => {
    expect(() => parseArgs(argv)).toThrow(error);
  });
});
