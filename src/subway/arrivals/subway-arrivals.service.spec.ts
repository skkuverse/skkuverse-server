/**
 * SubwayArrivalsService over FakeSubwayRepository, the real tracker's
 * timetable-only document (on the real timetable door, FakeCalendarService and
 * the trimmed fixture of revision 1, stored in a fake) and a fixed Clock. What it guards: an unserved
 * station, a KRIC platform id included, finds nothing; a platform's state at
 * most 2 minutes old is served as the tracker stored it, whatever SUBWAY says,
 * since the switch stops only the poller (ADR 0012, D5); an older or missing
 * state serves that platform's timetable alone at the request's time, every
 * train on the `timetable` basis; and at a station of two platforms
 * each is judged on its own ("One line stale"), on Gangnam's line 2 and Shinbundang
 * platforms. A served station carries its stored coords; with none stored for
 * it, or none read at all, it serves the station with null coords, never a
 * 503, while an unserved slug still finds nothing. Every answer carries
 * `meta.serverNow`, the clock at +09:00 to the second. One platform's calls,
 * which a journey ride boards by, are the board's for that platform, and none
 * for a platform the topology does not serve.
 */
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { storedSubwayTimetableService } from "../../../__tests__/helpers/subway/timetables";
import { FakeSubwayRepository } from "../../../__tests__/helpers/fakes/subway/subway.repository.fake";
import { storedSubwayTopologyService } from "../../../__tests__/helpers/subway/topology";
import { stationCoordsFixture, storedStationCoordsRepository, storedStationCoordsService } from "../../../__tests__/helpers/subway/station-coords";
import { FakeSubwayStationCoordsRepository } from "../../../__tests__/helpers/fakes/subway/subway-station-coords.repository.fake";
import type { Clock } from "../../infra/clock";
import config from "../../infra/config";
import { SubwayCountdownService } from "../countdown/subway-countdown.service";
import { SubwayEstimateService } from "../estimate/subway-estimate.service";
import type { SubwayArrivalsDoc } from "../subway.document";
import { SubwayStateService } from "../state/subway-state.service";
import type { SubwayRepository } from "../subway.repository";
import { SubwayPlatformArrivalsService } from "../platform-arrivals/subway-platform-arrivals.service";
import { SubwayTrackingService } from "../tracking/subway-tracking.service";
import { toCall } from "../../shared/call.util";
import { SubwayArrivalsService } from "./subway-arrivals.service";

const NOW = new Date("2026-10-16T11:41:00Z");
const subway = config.subway as { enabled: boolean };

function setup(stationCoords = storedStationCoordsRepository()) {
  const repository = new FakeSubwayRepository();
  const clock = { now: () => NOW } as Clock;
  const timetable = storedSubwayTimetableService({ clock });
  const tracking = new SubwayTrackingService(new SubwayStateService(asReal<SubwayRepository>(repository)), timetable, new SubwayEstimateService(new SubwayCountdownService()), clock);
  const platformArrivals = new SubwayPlatformArrivalsService(asReal<SubwayRepository>(repository), tracking, clock);
  return { repository, service: new SubwayArrivalsService(storedSubwayTopologyService(), storedStationCoordsService(stationCoords, clock), platformArrivals, clock) };
}

function storedAgo(ageMs: number, platformId = "S1-4-420"): SubwayArrivalsDoc {
  const generatedAt = new Date(NOW.getTime() - ageMs);
  const live = { trainNo: "4674", destination: "불암산", express: false, arrivalAt: new Date("2026-10-16T11:42:50Z"), source: "live" as const, isFirstTrain: false, position: null };
  return { _id: platformId, generatedAt, serviceDate: "2026-10-16", directions: { up: [live], down: [] } };
}

type Arrivals = Awaited<ReturnType<SubwayArrivalsService["findStationArrivals"]>>;

const basesOf = (arrivals: Arrivals, index = 0) => arrivals?.data.lines[index]?.directions.flatMap((d) => d.trains.map((t) => t.basis));

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
    expect(arrivals?.data.lines[0]?.generatedAt).toBe("2026-10-16T20:39:00+09:00");
    expect(basesOf(arrivals)).toEqual(["provider"]);
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
    expect(arrivals?.data.lines[0]?.generatedAt).toBe("2026-10-16T20:41:00+09:00");
    expect(basesOf(arrivals)).toEqual(Array(6).fill("timetable"));
  });

  it("serves a fresh stored state with SUBWAY=off, which stops only the poller", async () => {
    // Arrange
    subway.enabled = false;
    const { service, repository } = setup();
    repository.docs.set("S1-4-420", storedAgo(5_000));

    // Act
    const arrivals = await service.findStationArrivals("hyehwa", "ko");

    // Assert
    expect(arrivals?.data.lines[0]?.generatedAt).toBe("2026-10-16T20:40:55+09:00");
    expect(basesOf(arrivals)).toEqual(["provider"]);
  });

  it("serves the timetable alone, every train scheduled, with SUBWAY=off and no fresh state", async () => {
    // Arrange
    subway.enabled = false;
    const { service, repository } = setup();
    repository.docs.set("S1-4-420", storedAgo(121_000));

    // Act
    const arrivals = await service.findStationArrivals("hyehwa", "ko");

    // Assert
    expect(arrivals?.data.lines[0]?.generatedAt).toBe("2026-10-16T20:41:00+09:00");
    expect(basesOf(arrivals)).toEqual(Array(6).fill("timetable"));
  });

  it("One line stale: serves the fresh platform from its document and the stale one from its timetable alone", async () => {
    // Arrange
    const { service, repository } = setup();
    repository.docs.set("S1-2-222", storedAgo(5_000, "S1-2-222"));
    repository.docs.set("DX-D1-4307", storedAgo(121_000, "DX-D1-4307"));

    // Act
    const arrivals = await service.findStationArrivals("gangnam", "ko");

    // Assert
    expect(arrivals?.data.lines.map((l) => [l.platformId, l.generatedAt])).toEqual([
      ["S1-2-222", "2026-10-16T20:40:55+09:00"],
      ["DX-D1-4307", "2026-10-16T20:41:00+09:00"],
    ]);
    expect(basesOf(arrivals, 0)).toEqual(["provider"]);
    expect(basesOf(arrivals, 1)).toEqual(Array(6).fill("timetable"));
  });

  it("serves meta.serverNow, the clock at +09:00, beside a fresh state and beside the timetable alone", async () => {
    // Arrange
    const { service, repository } = setup();
    repository.docs.set("S1-2-222", storedAgo(5_000, "S1-2-222"));

    // Act
    const fresh = await service.findStationArrivals("gangnam", "ko");
    const scheduled = await service.findStationArrivals("hyehwa", "ko");

    // Assert
    expect(fresh?.meta).toEqual({ serverNow: "2026-10-16T20:41:00+09:00" });
    expect(scheduled?.meta).toEqual({ serverNow: "2026-10-16T20:41:00+09:00" });
  });

  it("serves the station's stored coords beside its name", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const arrivals = await service.findStationArrivals("jamsil", "en");

    // Assert
    expect(arrivals?.data.station).toEqual({ id: "jamsil", name: "Jamsil", coords: { lat: 37.513977, lng: 127.102249 } });
  });

  it("Coords never read: serves a served station with null coords and its lines", async () => {
    // Arrange
    const { service } = setup(new FakeSubwayStationCoordsRepository());

    // Act
    const arrivals = await service.findStationArrivals("hyehwa", "ko");

    // Assert
    expect(arrivals?.data.station).toEqual({ id: "hyehwa", name: "혜화", coords: null });
    expect(arrivals?.data.lines.map((line) => line.platformId)).toEqual(["S1-4-420"]);
  });

  it("Deploy adds a station before its coords: serves null coords for the station the revision lacks only", async () => {
    // Arrange
    const lacking = stationCoordsFixture();
    delete lacking.stations.dogok;
    const { service } = setup(storedStationCoordsRepository(lacking));

    // Act
    const dogok = await service.findStationArrivals("dogok", "ko");
    const yangjae = await service.findStationArrivals("yangjae", "ko");

    // Assert
    expect(dogok?.data.station.coords).toBeNull();
    expect(dogok?.data.lines.map((line) => line.platformId)).toEqual(["S1-3-334", "KR-K1-K217"]);
    expect(yangjae?.data.station.coords).toEqual({ lat: 37.484143, lng: 127.034278 });
  });

  it("finds nothing for an unserved slug even with no coords read", async () => {
    // Arrange
    const { service } = setup(new FakeSubwayStationCoordsRepository());

    // Act
    const arrivals = await service.findStationArrivals("seoul", "ko");

    // Assert
    expect(arrivals).toBeNull();
  });
});

describe("SubwayArrivalsService.listPlatformCalls", () => {
  it("is the calls the station board serves at one platform, from a fresh stored state", async () => {
    // Arrange
    const { service, repository } = setup();
    repository.docs.set("S1-4-420", storedAgo(5_000));
    const board = await service.findStationArrivals("hyehwa", "ko");
    const boardCalls = board?.data.lines[0]?.directions.flatMap((direction) => direction.trains.map(({ trainNo: _trainNo, ...train }) => train));

    // Act
    const calls = await service.listPlatformCalls("S1-4-420");

    // Assert
    expect(calls.map(toCall)).toEqual(boardCalls);
    expect(calls.map((call) => [call.runId, call.basis])).toEqual([["4/2026-10-16/4674", "provider"]]);
  });

  it("is the timetable's calls for a stale state, and none for a platform the topology does not serve", async () => {
    // Arrange
    const { service, repository } = setup();
    repository.docs.set("S1-4-420", storedAgo(121_000));

    // Act
    const [stale, unserved] = [await service.listPlatformCalls("S1-4-420"), await service.listPlatformCalls("S1-4-999")];

    // Assert
    expect(stale.map((call) => call.basis)).toEqual(Array(6).fill("timetable"));
    expect(unserved).toEqual([]);
  });
});
