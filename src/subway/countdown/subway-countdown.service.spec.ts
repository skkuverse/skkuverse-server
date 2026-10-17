/**
 * The countdown memory across ticks: each tick's rows count from the first publication of their countdown, as
 * the previous ticks saw it, spent or not; the estimate decides whether a train counts it.
 */
import type { CountdownRow } from "../subway.types";
import { SubwayCountdownService } from "./subway-countdown.service";

const HYEHWA = "S1-4-420";

const at = (kst: string): Date => new Date(`2026-10-17T${kst}+09:00`);

const row = (generatedAt: string, remainingSec: number): CountdownRow => ({ trainNo: "4540", stationId: HYEHWA, generatedAt: at(generatedAt), remainingSec });

describe("SubwayCountdownService.listFirstPublishedRows", () => {
  it("dates 4540's 150 s from 10:54:25 over the 2026-10-17 ticks, also once spent at 10:56:55", () => {
    // Arrange
    const countdown = new SubwayCountdownService();

    // Act
    const ticks = [
      countdown.listFirstPublishedRows([row("10:54:25", 150)]),
      countdown.listFirstPublishedRows([row("10:55:35", 150)]),
      countdown.listFirstPublishedRows([row("10:56:35", 150)]),
    ];

    // Assert
    expect(ticks).toEqual([[row("10:54:25", 150)], [row("10:54:25", 150)], [row("10:54:25", 150)]]);
  });

  it("gives the same rows to every station and direction a tick estimates", () => {
    // Arrange
    const countdown = new SubwayCountdownService();
    countdown.listFirstPublishedRows([row("10:54:25", 150)]);

    // Act
    const calls = [1, 2, 3].map(() => countdown.listFirstPublishedRows([row("10:55:35", 150)]));

    // Assert
    expect(calls).toEqual([[row("10:54:25", 150)], [row("10:54:25", 150)], [row("10:54:25", 150)]]);
  });

  it("forgets a train missing from a tick's rows, counting its next row from that row's own time", () => {
    // Arrange
    const countdown = new SubwayCountdownService();
    countdown.listFirstPublishedRows([row("10:54:25", 150)]);
    countdown.listFirstPublishedRows([]);

    // Act
    const rows = countdown.listFirstPublishedRows([row("10:55:35", 150)]);

    // Assert
    expect(rows).toEqual([row("10:55:35", 150)]);
  });
});
