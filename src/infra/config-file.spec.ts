/**
 * parseConfigFile, which every committed config file is parsed through: it
 * returns the parsed value, and a failed parse throws one line that starts
 * with the file's label and names each path, the root as `root`.
 */
import { z } from "zod";
import { parseConfigFile } from "./config-file";

describe("parseConfigFile", () => {
  const schema = z.strictObject({ id: z.string(), items: z.array(z.int()) });

  it("returns the parsed value", () => {
    // Act & Assert
    expect(parseConfigFile("x file", schema, { id: "a", items: [1] })).toEqual({ id: "a", items: [1] });
  });

  it("throws one line naming each failed path after the label", () => {
    // Act & Assert
    expect(() => parseConfigFile("x file", schema, { id: 1, items: [1, "2"], extra: true })).toThrow(
      /^x file: id: .+; items\.1: .+; root: Unrecognized key: "extra"$/,
    );
  });
});
