/**
 * The empty spell of a train-map line: how long a line's page has had no
 * train, over crawls at most MAX_EMPTY_CRAWL_GAP_MS apart, and when that is
 * too long to be the quiet before the first train (line 4 at 05:16 KST on
 * 2026-10-17). A longer gap between crawls, such as the overnight closure,
 * starts the spell over. And which train of the map is a branch train, by its
 * class's direction digit: 3 and above, which only line 2's shape lets through.
 */
import { MAX_EMPTY_CRAWL_GAP_MS, MAX_EMPTY_LINE_MS } from "./subway-seoul-trainmap.constants";
import { isBranchTrain, isEmptyTooLong, toEmptySpell } from "./subway-seoul-trainmap.rules";

const SINCE = new Date("2026-10-16T20:16:00Z");
const after = (ms: number): Date => new Date(SINCE.getTime() + ms);

describe("toEmptySpell", () => {
  it("starts a spell at the first empty crawl", () => {
    // Act
    const spell = toEmptySpell(undefined, SINCE);

    // Assert
    expect(spell).toEqual({ since: SINCE, lastAt: SINCE });
  });

  it.each([
    ["one below the gap", MAX_EMPTY_CRAWL_GAP_MS - 1, SINCE],
    ["at the gap", MAX_EMPTY_CRAWL_GAP_MS, SINCE],
    ["one above the gap", MAX_EMPTY_CRAWL_GAP_MS + 1, after(MAX_EMPTY_CRAWL_GAP_MS + 1)],
  ])("continues or restarts the spell for a crawl %s after the last", (_label, gapMs, since) => {
    // Act
    const spell = toEmptySpell({ since: SINCE, lastAt: SINCE }, after(gapMs));

    // Assert
    expect(spell).toEqual({ since, lastAt: after(gapMs) });
  });
});

describe("isEmptyTooLong", () => {
  it.each([
    ["one below the limit", MAX_EMPTY_LINE_MS - 1, false],
    ["at the limit", MAX_EMPTY_LINE_MS, false],
    ["one above the limit", MAX_EMPTY_LINE_MS + 1, true],
  ])("judges a spell %s (%i ms) too long: %s", (_label, spellMs, expected) => {
    // Act & Assert
    expect(isEmptyTooLong({ since: SINCE, lastAt: after(spellMs) })).toBe(expected);
  });
});

describe("isBranchTrain", () => {
  it.each([
    ["0", false],
    ["1", false],
    ["2", false],
    ["3", true],
    ["4", true],
    ["6", true],
  ])("judges direction digit %s a branch train's: %s", (directionDigit, expected) => {
    // Act & Assert
    expect(isBranchTrain(directionDigit)).toBe(expected);
  });
});
