/**
 * scripts/eventmap-revive-dev.js — the one-command `_dev` revive.
 *
 * The script exists to be the safe way to replay a festival, so the part worth
 * pinning is the refusal: nothing it plans may reach production, and the two
 * steps must carry the options to both children.
 */
// scripts/ is excluded from tsconfig (plain CommonJS operator tooling), so this
// is a require rather than an import.
const { planSteps } = require("../../../scripts/eventmap-revive-dev");

describe("eventmap-revive-dev — planSteps", () => {
  it("syncs the sheet into _dev, then opens a 240-minute dev window", () => {
    // Act & Assert
    expect(planSteps([], {})).toEqual([
      ["import-eventmap-places.js", "--delete-missing"],
      ["eventmap-window.js", "open", "--minutes", "240"],
    ]);
  });

  it("passes --file to the import and --layer-set-id to both steps", () => {
    // Act & Assert
    expect(
      planSteps(["--file", "x.json", "--layer-set-id", "eskara-2027", "--minutes", "30"], {}),
    ).toEqual([
      ["import-eventmap-places.js", "--file", "x.json", "--layer-set-id", "eskara-2027", "--delete-missing"],
      ["eventmap-window.js", "open", "--minutes", "30", "--layer-set-id", "eskara-2027"],
    ]);
  });

  it.each<[string, string[], Record<string, string>]>([
    ["NODE_ENV=production", [], { NODE_ENV: "production" }],
    ["--prod", ["--prod"], {}],
    ["--prod after other flags", ["--minutes", "30", "--prod"], {}],
  ])("refuses %s before planning anything", (_label, argv, env) => {
    // Act & Assert
    expect(() => planSteps(argv, env)).toThrow(/^refusing: /);
  });

  it("rejects an unknown argument and a flag with no value", () => {
    // Act & Assert
    expect(() => planSteps(["--delete-missing"], {})).toThrow(/unknown argument/);
    expect(() => planSteps(["--minutes"], {})).toThrow(/needs a value/);
    expect(() => planSteps(["--file", "--minutes", "5"], {})).toThrow(/needs a value/);
  });
});
