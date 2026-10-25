/**
 * The port records the registry and its error messages read: every port has its own token class and its own
 * label, so a missing implementation is reported under one unambiguous name.
 */
import { PORT_LABELS, PORT_NAMES, PORT_TOKENS } from "./perimeter.ports";

describe("PORT_TOKENS", () => {
  it("gives every port a token class of its own", () => {
    // Act
    const tokens = Object.values(PORT_TOKENS);

    // Assert
    expect(new Set(tokens).size).toBe(tokens.length);
    expect(Object.keys(PORT_TOKENS).sort()).toEqual(Object.keys(PORT_LABELS).sort());
  });
});

describe("PORT_NAMES", () => {
  it("names every port once", () => {
    // Act & Assert
    expect([...PORT_NAMES].sort()).toEqual(Object.keys(PORT_LABELS).sort());
  });
});

describe("PORT_LABELS", () => {
  it("names every port once, in upper snake case", () => {
    // Act
    const labels = Object.values(PORT_LABELS);

    // Assert
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.every((label) => /^[A-Z]+(?:_[A-Z]+)*$/.test(label))).toBe(true);
  });
});
