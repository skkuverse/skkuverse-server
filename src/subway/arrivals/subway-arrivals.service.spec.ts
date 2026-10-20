/**
 * SubwayArrivalsService over FakeSubwayRepository, the real tracker's
 * timetable-only document (on the real timetable door, FakeHolidaysService and
 * the trimmed fixture of revision 1, stored in a fake) and a fixed Clock. What it guards: an unserved
 * station, a KRIC platform id included, finds nothing; a platform's state at
 * most 2 minutes old is served as the tracker stored it, whatever SUBWAY says,
 * since the switch stops only the poller (ADR 0012, D5); an older or missing
 * state serves that platform's timetable alone at the request's time, every
 * train `scheduled`; and at a station of two platforms
 * each is judged on its own ("One line stale"), on Gangnam's line 2 and Shinbundang
 * platforms.
 */
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { storedSubwayTimetableService } from "../../../__tests__/helpers/subway/timetables";
import { FakeSubwayRepository } from "../../../__tests__/helpers/fakes/subway/subway.repository.fake";
import { storedSubwayTopologyService } from "../../../__tests__/helpers/subway/topology";
import type { Clock } from "../../infra/clock";
import config from "../../infra/config";
import { SubwayCountdownService } from "../countdown/subway-countdown.service";
import { SubwayEstimateService } from "../estimate/subway-estimate.service";
import type { SubwayArrivalsDoc } from "../subway.document";
import { SubwayStateService } from "../state/subway-state.service";
import type { SubwayRepository } from "../subway.repository";
import { SubwayTrackingService } from "../tracking/subway-tracking.service";
import { SubwayArrivalsService } from "./subway-arrivals.service";

const NOW = new Date("2026-10-16T11:41:00Z");
const subway = config.subway as { enabled: boolean };

function setup() {
  const repository = new FakeSubwayRepository();
  const clock = { now: () => NOW } as Clock;
  const timetable = storedSubwayTimetableService({ clock });
  const tracking = new SubwayTrackingService(new SubwayStateService(asReal<SubwayRepository>(repository)), timetable, new SubwayEstimateService(new SubwayCountdownService()), clock);
  return { repository, service: new SubwayArrivalsService(asReal<SubwayRepository>(repository), tracking, clock, storedSubwayTopologyService()) };
}

function storedAgo(ageMs: number, platformId = "S1-4-420"): SubwayArrivalsDoc {
  const generatedAt = new Date(NOW.getTime() - ageMs);
  const live = { trainNo: "4674", destination: "불암산", express: false, arrivalAt: new Date("2026-10-16T11:42:50Z"), source: "live" as const, position: null };
  return { _id: platformId, generatedAt, serviceDate: "2026-10-16", directions: { up: [live], down: [] } };
}

type Arrivals = Awaited<ReturnType<SubwayArrivalsService["findStationArrivals"]>>;

const sourcesOf = (arrivals: Arrivals, index = 0) => arrivals?.lines[index]?.directions.flatMap((d) => d.trains.map((t) => t.source));

const enabled = subway.enabled;
afterEach(() => {
  subway.enabled = enabled;
});

describe("SubwayArrivalsService.findStationArrivals", () => {
  it.each(["seoul", "S1-4-420"])("finds nothing for %s, which it does not serve as a station", async (stationId) => {
    // Arrange
    const { service } = setup();

    // Act
    const arrivals = await service.findStationArrivals(stationId, "ko");

    // Assert
    expect(arrivals).toBeNull();
  });

  it("serves a state 120 s old as the tracker stored it", async () => {
    // Arrange
    const { service, repository } = setup();
    repository.docs.set("S1-4-420", storedAgo(120_000));

    // Act
    const arrivals = await service.findStationArrivals("hyehwa", "ko");

    // Assert
    expect(arrivals?.lines[0]?.generatedAt).toBe("2026-10-16T11:39:00.000Z");
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
    const arrivals = await service.findStationArrivals("hyehwa", "ko");

    // Assert
    expect(arrivals?.lines[0]?.generatedAt).toBe(NOW.toISOString());
    expect(sourcesOf(arrivals)).toEqual(Array(6).fill("scheduled"));
  });

  it("serves a fresh stored state with SUBWAY=off, which stops only the poller", async () => {
    // Arrange
    subway.enabled = false;
    const { service, repository } = setup();
    repository.docs.set("S1-4-420", storedAgo(5_000));

    // Act
    const arrivals = await service.findStationArrivals("hyehwa", "ko");

    // Assert
    expect(arrivals?.lines[0]?.generatedAt).toBe("2026-10-16T11:40:55.000Z");
    expect(sourcesOf(arrivals)).toEqual(["live"]);
  });

  it("serves the timetable alone, every train scheduled, with SUBWAY=off and no fresh state", async () => {
    // Arrange
    subway.enabled = false;
    const { service, repository } = setup();
    repository.docs.set("S1-4-420", storedAgo(121_000));

    // Act
    const arrivals = await service.findStationArrivals("hyehwa", "ko");

    // Assert
    expect(arrivals?.lines[0]?.generatedAt).toBe(NOW.toISOString());
    expect(sourcesOf(arrivals)).toEqual(Array(6).fill("scheduled"));
  });

  it("One line stale: serves the fresh platform from its document and the stale one from its timetable alone", async () => {
    // Arrange
    const { service, repository } = setup();
    repository.docs.set("S1-2-222", storedAgo(5_000, "S1-2-222"));
    repository.docs.set("DX-D1-4307", storedAgo(121_000, "DX-D1-4307"));

    // Act
    const arrivals = await service.findStationArrivals("gangnam", "ko");

    // Assert
    expect(arrivals?.lines.map((l) => [l.platformId, l.generatedAt])).toEqual([
      ["S1-2-222", "2026-10-16T11:40:55.000Z"],
      ["DX-D1-4307", NOW.toISOString()],
    ]);
    expect(sourcesOf(arrivals, 0)).toEqual(["live"]);
    expect(sourcesOf(arrivals, 1)).toEqual(Array(6).fill("scheduled"));
  });
});
