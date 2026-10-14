/**
 * Phrases that narrate history (ADR 0010, D10): what code or a doc used to be,
 * what it was ported from, what it always did. Shared by the history-comments
 * rule over src/ comments and the module-docs rule over module docs.
 */

/** "used to" counts only with a subject: "x is used to build" is not history. */
export const HISTORY_PHRASES: ReadonlyArray<readonly [string, RegExp]> = [
  ["used to", /(?<![.:;!?]\s|^|\b(?:is|are|be|been|being|was|were|get|gets|got|getting)\s)\bused to\b/i],
  ["legacy", /\blegacy\b/i],
  ["ported", /\bported\b/i],
  ["byte-parity", /\bbyte[- ]parity\b/i],
  ["as it always has", /\bas (?:it|they) always (?:has|have|had|did)\b/i],
  ["previously", /\bpreviously\b/i],
  ["replaced by", /\breplaced by\b|\bwas replaced\b/i],
  ["formerly", /\bformerly\b/i],
  ["before the refactor", /\bbefore the (?:refactor|port|migration)\b/i],
  ["as before", /\b(?:as|than) before\b|\bas (?:it|they) (?:was|were|did)\b|\buntil now\b/i],
];
