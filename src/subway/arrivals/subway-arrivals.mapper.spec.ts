/**
 * toSubwayStationArrivals: a physical station and each of its platforms'
 * `subway_arrivals` documents become the arrivals response. The station
 * carries its slug, its name in the request language and the coords it is
 * handed, the camera point the app opens its sheet on, or null with none; each platform, in
 * the station's order, a line entry with the line's code, name, color and
 * marker (its one-character text in the request language and its color),
 * its KRIC id, its own document's generatedAt at +09:00 to the second and each of its two
 * directions, up then down,
 * its name, its previous station (the nearest upstream one) and its next
 * station, each by id and by name in that language, and its trains; each
 * train is ADR 0022's call plus its train number: a live or estimated time is
 * expected and the stored timetable arrival and departure scheduled beside it,
 * a scheduled train's time scheduled only; every instant at +09:00 to the
 * second; live, estimated and scheduled are the provider, estimate and
 * timetable bases; its status and stops away come from its stored position;
 * its run is `<line>/<serviceDate>/<trainNo>`; its destination is the
 * headsign, and its express, first-train and stored last-run flags are
 * served; a field a train stored before it lacks serves null. A previous or
 * next stop it has no name for is served as null, as a terminus is, and the
 * rest of the line still serves.
 */
import { subwayRegistryFixture } from "../../../__tests__/helpers/subway/topology";
import type { Call } from "../../shared/call.wire";
import type { StoredTrainArrival, SubwayArrivalsDoc } from "../subway.document";
import type { SubwayPlatform, SubwayStation } from "../subway.types";
import { toSubwayStationArrivals } from "./subway-arrivals.mapper";
import { findSubwayStation } from "./subway-arrivals.rules";

const REGISTRY = subwayRegistryFixture();
const HYEHWA = findSubwayStation("hyehwa", REGISTRY) as SubwayStation;
const SUNGKYUNKWAN = findSubwayStation("sungkyunkwan", REGISTRY) as SubwayStation;
const HYEHWA_PLATFORM = HYEHWA.platforms[0] as SubwayPlatform;
const HYEHWA_COORDS = { lat: 37.582336, lng: 127.001844 };
const GENERATED_AT = new Date("2026-10-16T11:41:00Z");
const DOC: SubwayArrivalsDoc = {
  _id: "S1-4-420",
  generatedAt: GENERATED_AT,
  serviceDate: "2026-10-16",
  directions: {
    up: [
      {
        trainNo: "4674",
        destination: "불암산",
        express: false,
        arrivalAt: new Date("2026-10-16T11:42:50Z"),
        source: "live",
        isFirstTrain: false,
        position: { stationId: "S1-4-421", state: "departed" },
      },
      { trainNo: "4676", destination: "불암산", express: false, arrivalAt: new Date("2026-10-16T11:48:00Z"), source: "scheduled", isFirstTrain: false, position: null },
    ],
    down: [
      {
        trainNo: "4171",
        destination: "사당",
        express: false,
        arrivalAt: new Date("2026-10-16T11:41:20Z"),
        source: "estimated",
        isFirstTrain: false,
        position: { stationId: "S1-4-420", state: "approaching" },
      },
      {
        trainNo: "4173",
        destination: "오이도",
        express: false,
        arrivalAt: new Date("2026-10-16T11:45:00Z"),
        source: "estimated",
        isFirstTrain: false,
        position: { stationId: "S1-4-418", state: "departed" },
      },
      {
        trainNo: "4175",
        destination: "오이도",
        express: false,
        arrivalAt: new Date("2026-10-16T11:49:00Z"),
        source: "estimated",
        isFirstTrain: false,
        position: { stationId: "S1-4-415", state: "arrived" },
      },
    ],
  },
};

// WHY: a train of DOC as a call, whose stored train carries none of the fields the poller added for the call.
const call = (status: Call["status"], basis: Call["basis"], instants: Partial<Call>): Call => ({
  status,
  expectedArrivalAt: null,
  expectedDepartureAt: null,
  scheduledArrivalAt: null,
  scheduledDepartureAt: null,
  basis,
  stopsAway: null,
  runId: null,
  vehicleId: null,
  headsign: null,
  isFirstRun: false,
  isLastRun: null,
  isExpress: false,
  providerText: null,
  ...instants,
});

describe("toSubwayStationArrivals", () => {
  it("names the station by its slug, its line, each direction and its neighbors in Korean, and serves each train as a call", () => {
    // Act
    const response = toSubwayStationArrivals(HYEHWA, [{ platform: HYEHWA_PLATFORM, doc: DOC }], { lang: "ko", registry: REGISTRY, coords: HYEHWA_COORDS });

    // Assert
    expect(response).toEqual({
      station: { id: "hyehwa", name: "혜화", coords: { lat: 37.582336, lng: 127.001844 } },
      lines: [
        {
          line: { code: "4", name: "4호선", color: "00A5DE", marker: { text: "4", color: "007FAB" } },
          platformId: "S1-4-420",
          generatedAt: "2026-10-16T20:41:00+09:00",
          directions: [
            {
              direction: "up",
              name: "불암산·진접 방면",
              previousStation: { id: "S1-4-421", name: "동대문" },
              nextStation: { id: "S1-4-419", name: "한성대입구" },
              trains: [
                { ...call("enRoute", "provider", { expectedArrivalAt: "2026-10-16T20:42:50+09:00" }), stopsAway: 1, runId: "4/2026-10-16/4674", headsign: "불암산", trainNo: "4674" },
                { ...call("scheduled", "timetable", { scheduledArrivalAt: "2026-10-16T20:48:00+09:00" }), runId: "4/2026-10-16/4676", headsign: "불암산", trainNo: "4676" },
              ],
            },
            {
              direction: "down",
              name: "오이도·안산 방면",
              previousStation: { id: "S1-4-419", name: "한성대입구" },
              nextStation: { id: "S1-4-421", name: "동대문" },
              trains: [
                { ...call("arriving", "estimate", { expectedArrivalAt: "2026-10-16T20:41:20+09:00" }), stopsAway: 1, runId: "4/2026-10-16/4171", headsign: "사당", trainNo: "4171" },
                { ...call("enRoute", "estimate", { expectedArrivalAt: "2026-10-16T20:45:00+09:00" }), stopsAway: 2, runId: "4/2026-10-16/4173", headsign: "오이도", trainNo: "4173" },
                { ...call("unknown", "estimate", { expectedArrivalAt: "2026-10-16T20:49:00+09:00" }), runId: "4/2026-10-16/4175", headsign: "오이도", trainNo: "4175" },
              ],
            },
          ],
        },
      ],
    });
  });

  it("serves a train stored as the first of its service day as the first", () => {
    // Arrange
    const [first, ...rest] = DOC.directions.down;
    const doc: SubwayArrivalsDoc = { ...DOC, directions: { up: [], down: [{ ...first!, isFirstTrain: true }, ...rest] } };

    // Act
    const response = toSubwayStationArrivals(HYEHWA, [{ platform: HYEHWA_PLATFORM, doc }], { lang: "ko", registry: REGISTRY, coords: HYEHWA_COORDS });

    // Assert
    const down = response.lines[0]?.directions.find((d) => d.direction === "down");
    expect(down?.trains.map((t) => [t.trainNo, t.isFirstRun])).toEqual([
      ["4171", true],
      ["4173", false],
      ["4175", false],
    ]);
  });

  describe("a train stored with the timetable times, last run and passes", () => {
    const legacyTrain = (extra: Partial<StoredTrainArrival>): StoredTrainArrival => ({
      trainNo: "4173",
      destination: "오이도",
      express: true,
      arrivalAt: new Date("2026-10-16T11:45:31.789Z"),
      source: "estimated",
      isFirstTrain: false,
      position: { stationId: "S1-4-417", state: "approaching" },
      ...extra,
    });
    const train = (extra: Partial<StoredTrainArrival>): StoredTrainArrival => ({
      ...legacyTrain({}),
      isLastRun: true,
      scheduledArrivalAt: new Date("2026-10-16T11:44:30Z"),
      scheduledDepartureAt: new Date("2026-10-16T11:45:00Z"),
      passedPlatformIds: ["S1-4-418"],
      ...extra,
    });
    const served = (stored: StoredTrainArrival) => {
      const doc: SubwayArrivalsDoc = { ...DOC, generatedAt: new Date("2026-10-16T11:41:07.654Z"), directions: { up: [], down: [stored] } };
      const [line] = toSubwayStationArrivals(HYEHWA, [{ platform: HYEHWA_PLATFORM, doc }], { lang: "ko", registry: REGISTRY, coords: null }).lines;
      return { generatedAt: line?.generatedAt, train: line?.directions[1]?.trains[0] };
    };

    it("serves its estimate as expected, its timetable pair as scheduled, its last-run and express flags, and no departure estimate", () => {
      // Act
      const { train: served4173 } = served(train({}));

      // Assert
      expect(served4173).toEqual({
        status: "enRoute",
        expectedArrivalAt: "2026-10-16T20:45:31+09:00",
        expectedDepartureAt: null,
        scheduledArrivalAt: "2026-10-16T20:44:30+09:00",
        scheduledDepartureAt: "2026-10-16T20:45:00+09:00",
        basis: "estimate",
        stopsAway: 3,
        runId: "4/2026-10-16/4173",
        vehicleId: null,
        headsign: "오이도",
        isFirstRun: false,
        isLastRun: true,
        isExpress: true,
        providerText: null,
        trainNo: "4173",
      });
    });

    it("serves the platform's generatedAt at +09:00 to the second", () => {
      // Act & Assert
      expect(served(train({})).generatedAt).toBe("2026-10-16T20:41:07+09:00");
    });

    it.each([
      ["live", "provider"],
      ["estimated", "estimate"],
    ] as const)("serves a %s train's time as expected, its basis %s", (source, basis) => {
      // Act
      const call4173 = served(train({ source }))?.train;

      // Assert
      expect([call4173?.basis, call4173?.expectedArrivalAt, call4173?.scheduledArrivalAt]).toEqual([basis, "2026-10-16T20:45:31+09:00", "2026-10-16T20:44:30+09:00"]);
    });

    it("serves a scheduled train's time as scheduled only, from the timetable", () => {
      // Act
      const call4173 = served(train({ source: "scheduled", arrivalAt: new Date("2026-10-16T11:44:30Z"), position: null }))?.train;

      // Assert
      expect([call4173?.status, call4173?.basis, call4173?.expectedArrivalAt, call4173?.scheduledArrivalAt, call4173?.scheduledDepartureAt]).toEqual([
        "scheduled",
        "timetable",
        null,
        "2026-10-16T20:44:30+09:00",
        "2026-10-16T20:45:00+09:00",
      ]);
    });

    it("serves a scheduled train at its origin, which has no arrival, by its scheduled departure", () => {
      // Act
      const call4173 = served(train({ source: "scheduled", arrivalAt: new Date("2026-10-16T11:45:00Z"), position: null, scheduledArrivalAt: null }))?.train;

      // Assert
      expect([call4173?.expectedArrivalAt, call4173?.scheduledArrivalAt, call4173?.scheduledDepartureAt]).toEqual([null, null, "2026-10-16T20:45:00+09:00"]);
    });

    it("serves null for each field a train stored before them lacks, and a scheduled one's time as its scheduled arrival", () => {
      // Act
      const estimated = served(legacyTrain({})).train;
      const scheduled = served(legacyTrain({ source: "scheduled", position: null })).train;

      // Assert
      expect([estimated?.isLastRun, estimated?.scheduledArrivalAt, estimated?.scheduledDepartureAt, estimated?.stopsAway]).toEqual([null, null, null, 4]);
      expect([scheduled?.expectedArrivalAt, scheduled?.scheduledArrivalAt, scheduled?.scheduledDepartureAt]).toEqual([null, "2026-10-16T20:45:31+09:00", null]);
    });

    it("names its run by the platform's line, the document's service date and its train number", () => {
      // Arrange
      const platform = SUNGKYUNKWAN.platforms[0] as SubwayPlatform;
      const doc: SubwayArrivalsDoc = { ...DOC, _id: platform.id, serviceDate: "2026-10-15", directions: { up: [train({ trainNo: "0493" })], down: [] } };

      // Act
      const [line] = toSubwayStationArrivals(SUNGKYUNKWAN, [{ platform, doc }], { lang: "ko", registry: REGISTRY, coords: null }).lines;

      // Assert
      expect(line?.directions[0]?.trains[0]?.runId).toBe("1/2026-10-15/0493");
    });
  });

  it.each([
    ["en", "Hyehwa", "Line 4", ["Toward Buramsan / Jinjeop", "Toward Oido / Ansan"]],
    ["zh", "惠化", "4号线", ["佛岩山·榛接方向", "乌耳岛·安山方向"]],
  ] as const)("labels the station, its line and its directions in %s", (lang, stationName, lineName, directionNames) => {
    // Act
    const response = toSubwayStationArrivals(HYEHWA, [{ platform: HYEHWA_PLATFORM, doc: DOC }], { lang, registry: REGISTRY, coords: HYEHWA_COORDS });

    // Assert
    const [line] = response.lines;
    expect([response.station.name, line?.line.name, line?.directions.map((d) => d.name)]).toEqual([stationName, lineName, directionNames]);
  });

  it.each(["ko", "en", "zh"] as const)("serves the station's coords as it is handed them, the same in %s", (lang) => {
    // Arrange
    const coords = { lat: 37.300349, lng: 126.97075 };
    const platform = SUNGKYUNKWAN.platforms[0] as SubwayPlatform;

    // Act
    const response = toSubwayStationArrivals(SUNGKYUNKWAN, [{ platform, doc: { ...DOC, _id: platform.id } }], { lang, registry: REGISTRY, coords });

    // Assert
    expect(response.station).toEqual({ id: "sungkyunkwan", name: { ko: "성균관대", en: "Sungkyunkwan Univ.", zh: "成均馆大学" }[lang], coords });
  });

  it("serves null coords when it is handed none, and the rest of the station as before", () => {
    // Act
    const response = toSubwayStationArrivals(HYEHWA, [{ platform: HYEHWA_PLATFORM, doc: DOC }], { lang: "ko", registry: REGISTRY, coords: null });

    // Assert
    expect(response.station).toEqual({ id: "hyehwa", name: "혜화", coords: null });
    expect(response.lines.map((line) => line.platformId)).toEqual(["S1-4-420"]);
  });

  it.each([
    [HYEHWA, "ko", [["동대문", "한성대입구"], ["한성대입구", "동대문"]]],
    [HYEHWA, "en", [["Dongdaemun", "Hansung Univ."], ["Hansung Univ.", "Dongdaemun"]]],
    [HYEHWA, "zh", [["东大门", "汉城大入口"], ["汉城大入口", "东大门"]]],
    [SUNGKYUNKWAN, "ko", [["화서", "의왕"], ["의왕", "화서"]]],
    [SUNGKYUNKWAN, "en", [["Hwaseo", "Uiwang"], ["Uiwang", "Hwaseo"]]],
    [SUNGKYUNKWAN, "zh", [["华西", "义王"], ["义王", "华西"]]],
  ] as const)("names $0.id's previous and next stations, up then down, in %s", (station, lang, neighborNames) => {
    // Arrange
    const platform = station.platforms[0] as SubwayPlatform;

    // Act
    const response = toSubwayStationArrivals(station, [{ platform, doc: { ...DOC, _id: platform.id } }], { lang, registry: REGISTRY, coords: HYEHWA_COORDS });

    // Assert
    expect(response.lines[0]?.directions.map((d) => [d.previousStation?.name, d.nextStation?.name])).toEqual(neighborNames);
  });

  it("serves one line entry per platform, in the station's order, each with its own document's generatedAt", () => {
    // Arrange
    const transfer: SubwayStation = { ...HYEHWA, id: "transfer", platforms: [HYEHWA_PLATFORM, SUNGKYUNKWAN.platforms[0] as SubwayPlatform] };
    const stale = { ...DOC, _id: "KR-1-0153", generatedAt: new Date("2026-10-16T11:30:00Z"), directions: { up: [], down: [] } };

    // Act
    const response = toSubwayStationArrivals(transfer, transfer.platforms.map((platform, i) => ({ platform, doc: i === 0 ? DOC : stale })), { lang: "en", registry: REGISTRY, coords: HYEHWA_COORDS });

    // Assert
    expect(response.lines.map((l) => [l.line.code, l.line.marker.text, l.line.color, l.platformId, l.generatedAt])).toEqual([
      ["4", "4", "00A5DE", "S1-4-420", "2026-10-16T20:41:00+09:00"],
      ["1", "1", "0052A4", "KR-1-0153", "2026-10-16T20:30:00+09:00"],
    ]);
  });

  it.each([
    ["ko", "신분당선", "신"],
    ["en", "Shinbundang Line", "신"],
    ["zh", "新盆唐线", "新"],
  ] as const)("serves a named line's name and marker text in %s, its colors in every language", (lang, name, text) => {
    // Arrange
    const jeongja = findSubwayStation("jeongja", REGISTRY) as SubwayStation;
    const platform = jeongja.platforms[0] as SubwayPlatform;

    // Act
    const response = toSubwayStationArrivals(jeongja, [{ platform, doc: { ...DOC, _id: platform.id } }], { lang, registry: REGISTRY, coords: HYEHWA_COORDS });

    // Assert
    expect(response.lines[0]?.line).toEqual({ code: "D1", name, color: "D4003B", marker: { text, color: "D4003B" } });
  });

  it("serves null for a previous and a next station it has no name for, and the rest of the direction as before", () => {
    // Arrange
    const up = { ...HYEHWA_PLATFORM.directions.up, upstreamPlatformIds: ["S1-4-498", "S1-4-422", "S1-4-423"], nextPlatformId: "S1-4-499" };
    const platform: SubwayPlatform = { ...HYEHWA_PLATFORM, directions: { ...HYEHWA_PLATFORM.directions, up } };

    // Act
    const response = toSubwayStationArrivals(HYEHWA, [{ platform, doc: DOC }], { lang: "ko", registry: REGISTRY, coords: HYEHWA_COORDS });

    // Assert
    const [upDirection, downDirection] = response.lines[0]?.directions ?? [];
    expect([upDirection?.previousStation, upDirection?.nextStation]).toEqual([null, null]);
    expect([upDirection?.name, upDirection?.trains.map((train) => train.trainNo)]).toEqual(["불암산·진접 방면", ["4674", "4676"]]);
    expect(downDirection?.previousStation).toEqual({ id: "S1-4-419", name: "한성대입구" });
  });
});
