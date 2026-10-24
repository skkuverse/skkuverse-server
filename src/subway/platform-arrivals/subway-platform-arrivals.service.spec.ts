/**
 * SubwayPlatformArrivalsService over FakeSubwayRepository, the real tracker's
 * timetable-only document (on the real timetable door, FakeCalendarService and
 * the trimmed fixture of revision 1, stored in a fake) and a fixed Clock: the
 * arrivals document each platform is served from, in the order asked. A
 * platform's stored state at most 2 minutes old is served as the tracker
 * stored it, whatever SUBWAY says, since the switch stops only the poller
 * (ADR 0012, D5); an older or missing state serves that platform's timetable
 * alone at the request's time, and each platform is judged on its own.
 */
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { FakeSubwayRepository } from "../../../__tests__/helpers/fakes/subway/subway.repository.fake";
import { storedSubwayTimetableService } from "../../../__tests__/helpers/subway/timetables";
import { subwayRegistryFixture } from "../../../__tests__/helpers/subway/topology";
import type { Clock } from "../../infra/clock";
import config from "../../infra/config";
import { SubwayCountdownService } from "../countdown/subway-countdown.service";
import { SubwayEstimateService } from "../estimate/subway-estimate.service";
import { SubwayStateService } from "../state/subway-state.service";
import type { SubwayArrivalsDoc } from "../subway.document";
import type { SubwayRepository } from "../subway.repository";
import type { SubwayPlatform } from "../subway.types";
import { SubwayTrackingService } from "../tracking/subway-tracking.service";
import { SubwayPlatformArrivalsService } from "./subway-platform-arrivals.service";

const NOW = new Date("2026-10-16T11:41:00Z");
const subway = config.subway as { enabled: boolean };
const platformsOf = (stationId: string): SubwayPlatform[] => [...subwayRegistryFixture().stations.find((station) => station.id === stationId)!.platforms];

function setup() {
  const repository = new FakeSubwayRepository();
  const clock = { now: () => NOW } as Clock;
  const timetable = storedSubwayTimetableService({ clock });
  const tracking = new SubwayTrackingService(new SubwayStateService(asReal<SubwayRepository>(repository)), timetable, new SubwayEstimateService(new SubwayCountdownService()), clock);
  return { repository, service: new SubwayPlatformArrivalsService(asReal<SubwayRepository>(repository), tracking, clock) };
}

function storedAgo(ageMs: number, platformId: string): SubwayArrivalsDoc {
  const generatedAt = new Date(NOW.getTime() - ageMs);
  const live = { trainNo: "4674", destination: "불암산", express: false, arrivalAt: new Date("2026-10-16T11:42:50Z"), source: "live" as const, isFirstTrain: false, position: null };
  return { _id: platformId, generatedAt, serviceDate: "2026-10-16", directions: { up: [live], down: [] } };
}

const sourcesOf = (doc: SubwayArrivalsDoc | undefined): string[] => (doc ? [...doc.directions.up, ...doc.directions.down].map((train) => train.source) : []);

const enabled = subway.enabled;
afterEach(() => {
  subway.enabled = enabled;
});

describe("SubwayPlatformArrivalsService.listPlatformArrivals", () => {
  it.each([
    ["120 s old", 120_000, "2026-10-16T11:39:00.000Z", ["live"]],
    ["121 s old", 121_000, NOW.toISOString(), ["scheduled", "scheduled", "scheduled", "scheduled", "scheduled", "scheduled"]],
  ])("serves hyehwa's platform from a state %s as the threshold says", async (_label, ageMs, generatedAt, sources) => {
    // Arrange
    const { service, repository } = setup();
    repository.docs.set("S1-4-420", storedAgo(ageMs, "S1-4-420"));

    // Act
    const [served] = await service.listPlatformArrivals(platformsOf("hyehwa"));

    // Assert
    expect(served?.platform.id).toBe("S1-4-420");
    expect(served?.doc.generatedAt.toISOString()).toBe(generatedAt);
    expect(sourcesOf(served?.doc)).toEqual(sources);
  });

  it("serves the timetable alone for a platform with no stored state", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const [served] = await service.listPlatformArrivals(platformsOf("hyehwa"));

    // Assert
    expect(served?.doc.generatedAt).toEqual(NOW);
    expect(sourcesOf(served?.doc)).toEqual(Array(6).fill("scheduled"));
  });

  it("serves a fresh stored state with SUBWAY=off, which stops only the poller", async () => {
    // Arrange
    subway.enabled = false;
    const { service, repository } = setup();
    repository.docs.set("S1-4-420", storedAgo(5_000, "S1-4-420"));

    // Act
    const [served] = await service.listPlatformArrivals(platformsOf("hyehwa"));

    // Assert
    expect(sourcesOf(served?.doc)).toEqual(["live"]);
  });

  it("One line stale: serves each platform on its own, in the order asked", async () => {
    // Arrange
    const { service, repository } = setup();
    repository.docs.set("S1-2-222", storedAgo(5_000, "S1-2-222"));
    repository.docs.set("DX-D1-4307", storedAgo(121_000, "DX-D1-4307"));

    // Act
    const served = await service.listPlatformArrivals(platformsOf("gangnam"));

    // Assert
    expect(served.map(({ platform, doc }) => [platform.id, doc.generatedAt.toISOString(), sourcesOf(doc)[0]])).toEqual([
      ["S1-2-222", "2026-10-16T11:40:55.000Z", "live"],
      ["DX-D1-4307", NOW.toISOString(), "scheduled"],
    ]);
  });
});
