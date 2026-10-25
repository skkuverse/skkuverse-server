/**
 * JourneyDeparturesService, the registry (ADR 0022, D6): a dataset line's source picks its door, and the query reaches
 * it unchanged, so a `busTimetable` line is answered by the timetabled-shuttle door with its runs and its next service.
 */
import { storedBusStopsService } from "../../../__tests__/helpers/bus/bus-stops";
import { FakeBusEtaSmartService } from "../../../__tests__/helpers/fakes/bus/bus-eta-smart.service.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { BusDeparturesTimetableService } from "../../bus/departures/timetable/bus-departures-timetable.service";
import type { BusEtaSmartService } from "../../bus/eta/smart/bus-eta-smart.service";
import { JourneyDeparturesService } from "./journey-departures.service";

const kst = (time: string) => new Date(`2026-10-20T${time}:00+09:00`);
const stopTime = (at: Date | null) => ({ shownAt: at, isEstimated: false, latestEstimateAt: null, timetableAt: at });
const run = (time: string) => ({
  runId: `campus-inja|regular|2026-10-20|${time}`,
  ...{ routeType: "regular", date: "2026-10-20", departureAt: kst(time), isFirstOfDay: false, isLastOfDay: false },
  stopTimes: [stopTime(kst(time)), stopTime(null)],
  estimate: null,
});

describe("JourneyDeparturesService.listDepartures", () => {
  it("answers a busTimetable line from the timetabled-shuttle door", async () => {
    // Arrange
    const smart = new FakeBusEtaSmartService();
    smart.runLists.set("campus-inja", { status: "active", runs: [run("14:30"), run("18:00")] });
    const registry = new JourneyDeparturesService(new BusDeparturesTimetableService(asReal<BusEtaSmartService>(smart), storedBusStopsService()));
    const query = { lineId: "campus-inja", boardStopId: "hssc-bus-lot", alightStopId: "nsc-n-center", from: kst("14:10"), until: kst("17:10"), lang: "ko" as const };

    // Act
    const board = await registry.listDepartures("busTimetable", query);

    // Assert
    expect(board.departures.map((departure) => departure.board.runId)).toEqual(["campus-inja|regular|2026-10-20|14:30"]);
    expect(board.nextServiceAt).toEqual(kst("18:00"));
  });
});
