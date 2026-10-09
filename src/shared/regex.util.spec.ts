import { escapeRegex } from "./regex.util";

describe("escapeRegex", () => {
  it("escapes every metacharacter", () => {
    expect(escapeRegex(".*+?^${}()|[]\\")).toBe("\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\");
  });

  it("matches the input literally", () => {
    for (const input of ["a.b", "(27)", "c++", "1+1=2", "[x]", "도서관?"]) {
      expect(new RegExp(`^${escapeRegex(input)}$`).test(input)).toBe(true);
    }
    expect(new RegExp(escapeRegex("a.b")).test("axb")).toBe(false);
  });
});
