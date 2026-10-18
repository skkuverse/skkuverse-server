/**
 * The estimate door over ticks: a published countdown counts from its first publication, so an arrival read
 * from it holds still while the upstream republishes it, and once it is spent, or the train is seen at the
 * station, the train's estimate is served. A document from the timetable alone leaves that memory alone.
 */
import { SubwayCountdownService } from "../countdown/subway-countdown.service";
import type { CountdownRow } from "../subway.types";
import type { ScheduledTrain } from "../timetable/subway-timetable.types";
import type { TrainHistory, TrainProgress } from "../tracking/subway-tracking.types";
import { SubwayEstimateService } from "./subway-estimate.service";

const HYEHWA = "S1-4-420";

const at = (kst: string): Date => new Date(`2026-10-17T${kst}+09:00`);

/** Train 4540 on the 2026-10-17 Saturday table, northbound through Hyehwa at 10:53:30–10:54:00. */
const T4540: ScheduledTrain = {
  trainNo: "4540",
  direction: "up",
  destination: "불암산",
  express: false,
  stops: [
    ["S1-4-422", "10:49:30", "10:50:00"],
    ["S1-4-421", "10:51:00", "10:51:30"],
    [HYEHWA, "10:53:30", "10:54:00"],
    ["S1-4-419", "10:55:30", "10:56:00"],
  ].map(([platformId, arrival, departure]) => ({ platformId: platformId!, arrivalAt: at(arrival!), departureAt: at(departure!) })),
};

const historyAt = (latest: Omit<TrainProgress, "ordinal">): ReadonlyMap<string, TrainHistory> =>
  new Map([["4540", { trainNo: "4540", direction: "up", destination: "불암산", latest: { ...latest, ordinal: 0 }, lastSeenAt: latest.at }]]);

const row = (generatedAt: string): CountdownRow => ({ trainNo: "4540", platformId: HYEHWA, generatedAt: at(generatedAt), remainingSec: 150 });

describe("SubwayEstimateService.estimateArrivals", () => {
  it("serves 4540 at 10:56:55 while 동대문 republishes its 150 s, then from its approach at 10:57:06, not 10:58:05 and 10:59:05", () => {
    // Arrange
    const estimate = new SubwayEstimateService(new SubwayCountdownService());
    const ticks = [
      { now: "10:55:12", generatedAt: "10:54:25", latest: { platformId: "S1-4-421", state: "arrived", at: at("10:54:33") } },
      { now: "10:56:12", generatedAt: "10:55:35", latest: { platformId: "S1-4-421", state: "departed", at: at("10:55:49") } },
      { now: "10:57:12", generatedAt: "10:56:35", latest: { platformId: HYEHWA, state: "approaching", at: at("10:57:06") } },
    ] as const;

    // Act
    const served = ticks.map((tick) =>
      estimate
        .estimateArrivals({
          platformId: HYEHWA,
          direction: "up",
          trains: [T4540],
          histories: historyAt(tick.latest),
          countdownRows: [row(tick.generatedAt)],
          now: at(tick.now),
        })
        .arrivals.map((a) => [a.arrivalAt, a.source]),
    );

    // Assert
    // WHY: 4540 arrived at 10:57:17; the approach is taken to lead an arrival by 30 s.
    expect(served).toEqual([[[at("10:56:55"), "live"]], [[at("10:56:55"), "live"]], [[at("10:57:36"), "estimated"]]]);
  });
});

describe("SubwayEstimateService.listScheduledArrivals", () => {
  it("serves 4540 at its scheduled 10:53:30 and leaves the countdown memory as the ticks left it", () => {
    // Arrange
    const estimate = new SubwayEstimateService(new SubwayCountdownService());
    const tick = { platformId: HYEHWA, direction: "up", trains: [T4540] } as const;
    const histories = historyAt({ platformId: "S1-4-421", state: "departed", at: at("10:55:49") });
    estimate.estimateArrivals({ ...tick, histories, countdownRows: [row("10:54:25")], now: at("10:55:12") });

    // Act
    const scheduled = estimate.listScheduledArrivals({ ...tick, now: at("10:53:00") });
    const next = estimate.estimateArrivals({ ...tick, histories, countdownRows: [row("10:55:35")], now: at("10:56:12") });

    // Assert
    expect(scheduled.map((a) => [a.arrivalAt, a.source])).toEqual([[at("10:53:30"), "scheduled"]]);
    expect(next.arrivals.map((a) => [a.arrivalAt, a.source])).toEqual([[at("10:56:55"), "live"]]);
  });
});
