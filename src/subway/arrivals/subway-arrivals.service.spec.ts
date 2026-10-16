/**
 * SubwayArrivalsService over FakeSubwayRepository, the real tracker's
 * timetable-only document (on the real timetable door, FakeHolidaysService and
 * the committed weekday tables) and a fixed Clock. What it guards: an unserved
 * station finds nothing; a state at most 2 minutes old is served as the
 * tracker stored it; an older or missing state, or SUBWAY=off, serves the
 * timetable alone at the request's time, every train `scheduled`.
 */
import { FakeHolidaysService } from "../../../__tests__/helpers/fakes/holidays/holidays.service.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { FakeSubwayRepository } from "../../../__tests__/helpers/fakes/subway/subway.repository.fake";
import type { HolidaysService } from "../../holidays/holidays.service";
import type { Clock } from "../../infra/clock";
import config from "../../infra/config";
import { SubwayEstimateService } from "../estimate/subway-estimate.service";
import type { SubwayArrivalsDoc } from "../subway.document";
import type { SubwayRepository } from "../subway.repository";
import { SubwayTimetableService } from "../timetable/subway-timetable.service";
import { SubwayTrackingService } from "../tracking/subway-tracking.service";
import { SubwayArrivalsService } from "./subway-arrivals.service";

const NOW = new Date("2026-10-16T11:41:00Z");
const subway = config.subway as { enabled: boolean };

function setup() {
  const repository = new FakeSubwayRepository();
  const clock = { now: () => NOW } as Clock;
  const timetable = new SubwayTimetableService(asReal<HolidaysService>(new FakeHolidaysService()));
  const tracking = new SubwayTrackingService(asReal<SubwayRepository>(repository), timetable, new SubwayEstimateService(), clock);
  return { repository, service: new SubwayArrivalsService(asReal<SubwayRepository>(repository), tracking, clock) };
}

function storedAgo(ageMs: number): SubwayArrivalsDoc {
  const generatedAt = new Date(NOW.getTime() - ageMs);
  const live = { trainNo: "4674", destination: "불암산", express: false, arrivalAt: new Date("2026-10-16T11:42:50Z"), source: "live" as const, position: null };
  return { _id: "S1-4-420", generatedAt, serviceDate: "2026-10-16", directions: { up: [live], down: [] } };
}

const sourcesOf = (arrivals: Awaited<ReturnType<SubwayArrivalsService["findStationArrivals"]>>) =>
  arrivals?.directions.flatMap((d) => d.trains.map((t) => t.source));

const enabled = subway.enabled;
afterEach(() => {
  subway.enabled = enabled;
});

describe("SubwayArrivalsService.findStationArrivals", () => {
  it("finds nothing for a station it does not serve", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const arrivals = await service.findStationArrivals("S1-2-222", "ko");

    // Assert
    expect(arrivals).toBeNull();
  });

  it("serves a state 120 s old as the tracker stored it", async () => {
    // Arrange
    const { service, repository } = setup();
    repository.docs.set("S1-4-420", storedAgo(120_000));

    // Act
    const arrivals = await service.findStationArrivals("S1-4-420", "ko");

    // Assert
    expect(arrivals?.generatedAt).toBe("2026-10-16T11:39:00.000Z");
    expect(sourcesOf(arrivals)).toEqual(["live"]);
  });

  it.each([
    ["121 s old", (repository: FakeSubwayRepository) => repository.docs.set("S1-4-420", storedAgo(121_000))],
    ["missing", () => undefined],
  ])("serves the timetable alone, every train scheduled, for a state %s", async (_label, arrange) => {
    // Arrange
    const { service, repository } = setup();
    arrange(repository);

    // Act
    const arrivals = await service.findStationArrivals("S1-4-420", "ko");

    // Assert
    expect(arrivals?.generatedAt).toBe(NOW.toISOString());
    expect(sourcesOf(arrivals)).toEqual(Array(6).fill("scheduled"));
  });

  it("serves the timetable alone with SUBWAY=off, a fresh state notwithstanding", async () => {
    // Arrange
    subway.enabled = false;
    const { service, repository } = setup();
    repository.docs.set("S1-4-420", storedAgo(5_000));

    // Act
    const arrivals = await service.findStationArrivals("S1-4-420", "ko");

    // Assert
    expect(sourcesOf(arrivals)).toEqual(Array(6).fill("scheduled"));
  });
});
