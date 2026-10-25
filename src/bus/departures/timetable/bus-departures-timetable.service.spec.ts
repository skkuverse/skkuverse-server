/**
 * BusDeparturesTimetableService, the door for timetabled shuttles (ADR 0022, D6), over the scripted run read and
 * revision 1 of `bus-stops`: an INJA shuttle leg from hssc-bus-lot to nsc-n-center lists every run of the shown week from the
 * start of the KST day, regular and hakbu alike, joined by run and headed by the service's label in the request
 * language; it reads the following week only when nothing follows the window, for the next service; a service that
 * does not call at the stops in that order throws DepartureUnavailableError.
 */
import type { BusEtaSmartService } from "../../eta/smart/bus-eta-smart.service";
import type { RunStopTime, ShuttleRun } from "../../eta/smart/bus-eta-smart.types";
import { DepartureUnavailableError } from "../../../shared/departure.error";
import { storedBusStopsService } from "../../../../__tests__/helpers/bus/bus-stops";
import { FakeBusEtaSmartService } from "../../../../__tests__/helpers/fakes/bus/bus-eta-smart.service.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import { BusDeparturesTimetableService } from "./bus-departures-timetable.service";

const kst = (date: string, time: string) => new Date(`${date}T${time}:00+09:00`);
const timetable = (at: Date | null): RunStopTime => ({ shownAt: at, isEstimated: false, latestEstimateAt: null, timetableAt: at });

function run(date: string, time: string, routeType = "regular"): ShuttleRun {
  return {
    runId: `campus-inja|${routeType}|${date}|${time}`,
    routeType,
    date,
    departureAt: kst(date, time),
    isFirstOfDay: false,
    isLastOfDay: false,
    stopTimes: [timetable(kst(date, time)), timetable(null)],
    estimate: null,
  };
}

const AT_14_10_KST = kst("2026-10-20", "14:10");
const query = (from = AT_14_10_KST, overrides: Partial<{ boardStopId: string; alightStopId: string; lang: "ko" | "en" }> = {}) => ({
  lineId: "campus-inja",
  boardStopId: "hssc-bus-lot",
  alightStopId: "nsc-n-center",
  from,
  until: new Date(from.getTime() + 3 * 3_600_000),
  lang: "ko" as const,
  ...overrides,
});

function serviceOver(smart: FakeBusEtaSmartService): BusDeparturesTimetableService {
  return new BusDeparturesTimetableService(asReal<BusEtaSmartService>(smart), storedBusStopsService());
}

describe("BusDeparturesTimetableService.listDepartures", () => {
  it("lists the regular and 학부대학 runs of the leg, joined by run, headed by the service's label in the request language", async () => {
    // Arrange
    const smart = new FakeBusEtaSmartService();
    const lastOfDay = run("2026-10-20", "18:00", "hakbu");
    smart.runLists.set("campus-inja", { status: "active", runs: [run("2026-10-20", "08:00"), run("2026-10-20", "14:30"), run("2026-10-20", "15:00", "hakbu"), lastOfDay] });

    // Act
    const board = await serviceOver(smart).listDepartures(query(AT_14_10_KST, { lang: "en" }));

    // Assert
    expect(board.departures.map(({ board: call }) => [call.runId, call.headsign, call.isFirstRun, call.isLastRun])).toEqual([
      ["campus-inja|regular|2026-10-20|14:30", "HSSC → NSC", false, false],
      ["campus-inja|hakbu|2026-10-20|15:00", "HSSC → NSC", false, false],
    ]);
    expect(board.departures.map((departure) => departure.lineId)).toEqual(["campus-inja", "campus-inja"]);
    expect(board.nextServiceAt).toEqual(lastOfDay.departureAt);
    expect(smart.followingReadServiceIds).toEqual([]);
  });

  it("Day ended: reads the following week for the next service when nothing follows the window", async () => {
    // Arrange
    const smart = new FakeBusEtaSmartService();
    smart.runLists.set("campus-inja", { status: "active", runs: [run("2026-10-23", "17:00")] });
    smart.followingRuns.set("campus-inja", [run("2026-10-26", "08:00")]);

    // Act
    const board = await serviceOver(smart).listDepartures(query(kst("2026-10-23", "20:00")));

    // Assert
    expect(board.departures).toEqual([]);
    expect(board.nextServiceAt).toEqual(kst("2026-10-26", "08:00"));
    expect(smart.followingReadServiceIds).toEqual(["campus-inja"]);
  });

  it("Reversed pair: throws DepartureUnavailableError for stops the service does not call at in that order", async () => {
    // Arrange
    const smart = new FakeBusEtaSmartService();
    smart.runLists.set("campus-inja", { status: "active", runs: [run("2026-10-20", "14:30")] });

    // Act
    const listed = serviceOver(smart).listDepartures(query(AT_14_10_KST, { boardStopId: "nsc-n-center", alightStopId: "hssc-bus-lot" }));

    // Assert
    await expect(listed).rejects.toBeInstanceOf(DepartureUnavailableError);
    expect(smart.readServiceIds).toEqual([]);
  });
});
