/**
 * How a published countdown is read over time. An upstream publishes a train's seconds to a station per segment
 * (its station before), and republishes the same seconds with each new row time while the train stays in that
 * segment, so a countdown counts from its first publication. One spent before the train shows up counts no more.
 */
import type { CountdownRow } from "../subway.types";
import { toCountingRows, toFirstPublishedRows } from "./subway-countdown.rules";

const HYEHWA = "S1-4-420";

const at = (kst: string): Date => new Date(`2026-10-17T${kst}+09:00`);

const row = (trainNo: string, generatedAt: string, remainingSec: number, stationId = HYEHWA): CountdownRow => ({
  trainNo,
  stationId,
  generatedAt: at(generatedAt),
  remainingSec,
});

describe("toFirstPublishedRows", () => {
  it("counts 4540's 150 s, republished at 10:55:35, from its first publication at 10:54:25", () => {
    // Act
    const rows = toFirstPublishedRows([row("4540", "10:54:25", 150)], [row("4540", "10:55:35", 150)]);

    // Assert
    expect(rows).toEqual([row("4540", "10:54:25", 150)]);
  });

  it.each([
    ["a new countdown for the same train", row("4540", "10:54:25", 240)],
    ["the same countdown of another train", row("4542", "10:54:25", 150)],
    ["the same countdown at another station", row("4540", "10:54:25", 150, "KR-1-0153")],
  ])("keeps a row's own time against %s", (_label, previous) => {
    // Act
    const rows = toFirstPublishedRows([previous], [row("4540", "10:55:35", 150)]);

    // Assert
    expect(rows).toEqual([row("4540", "10:55:35", 150)]);
  });

  it("keeps the earlier time when a previous row is newer than the one published now", () => {
    // Act
    const rows = toFirstPublishedRows([row("4540", "10:55:35", 150)], [row("4540", "10:54:25", 150)]);

    // Assert
    expect(rows).toEqual([row("4540", "10:54:25", 150)]);
  });
});

describe("toCountingRows", () => {
  it.each([
    ["1 s before it is spent", "10:56:54", 1],
    ["when it is spent", "10:56:55", 0],
    ["1 s after it is spent", "10:56:56", 0],
  ])("counts 4540's 150 s, first published at 10:54:25, %s only while some remain", (_label, now, count) => {
    // Act & Assert
    expect(toCountingRows([row("4540", "10:54:25", 150)], at(now))).toHaveLength(count);
  });
});
