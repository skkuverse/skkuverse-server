/**
 * The boarding-stop catalog validator (stops and stop sequences): one case per rule,
 * each asserting the error names its stop or
 * service. Revision 1 of the bus-stops dataset (the fixture) passes it; the
 * stored revision itself is checked at push and at read.
 *
 * Ported: the catalog these cases
 * pass is revision 1 instead of the committed stop catalog, which was
 * deleted; its root message names the dataset instead of the file.
 *
 * toBusStopsIssues is every check a `bus-stops` push runs after its schema:
 * the catalog checks that stopped the boot of the
 * committed file, in their own words, the stop subway stations, the estimate
 * opt-ins, the lane strategies against the sequences the data estimates, the
 * HSSC line, and the aliases and overlay. Each issue names its path in the
 * dataset. Revision 1 (the fixture) has none.
 *
 * Ported from src/bus/stops/bus-stops.config.spec.ts (old → new): "throws on a
 * stop naming a station the registry does not serve, naming the stop and the
 * value" → "Unknown station stops the boot", and from bus-stops.schema.spec.ts
 * "fails the committed catalog with jeongja-exit2 naming the station jeongja2"
 * and "reports the station issue beside the other catalog issues, in one
 * parse" → the same scenario and "reports a catalog issue beside a station
 * issue"; the startup checks of `assertLaneStrategies` → "Strategy for an
 * unknown sequence".
 *
 * Moved from src/bus/stops/check/bus-stops-check.rules.spec.ts unchanged,
 * when the push checks came back into this file.
 */
import { busStopsFixture } from "../../../__tests__/helpers/bus/bus-stops";
import { SERVICE_CONFIG as serviceConfig } from "../bus.constants";
import type { LaneStrategies } from "../eta/lane/bus-eta-lane.types";
import { SubwayStationsService } from "../../subway/stations/subway-stations.service";
import type { BusStopsData } from "./bus-stops.document";
import { etaOptIns, storedLineAndAliasErrors, subwayStationErrors, toBusStopsIssues, validateStopCatalog } from "./bus-stops.rules";
import type { ScheduleStopCatalog } from "./bus-stops.types";

const SERVED_STATIONS = new Set(new SubwayStationsService().listStations().map((station) => station.id));
const stopCatalog = busStopsFixture() as unknown as ScheduleStopCatalog;

const SERVICES = new Set(["commute-jeongja"]);
const MEDIA = "https://media.skkuverse.com/commute/stops/jeongja-exit3";
const EXIT = { lat: 37.365922, lng: 127.107774 };
const STOP = { lat: 37.365499, lng: 127.107906 };

function validStop(): Record<string, unknown> {
  return {
    id: "jeongja-exit3",
    name: { ko: "정자역 3번 출구", en: "Jeongja Stn. Exit 3" },
    detail: { ko: "파리바게뜨 앞" },
    coords: { ...STOP },
    photo: {
      original: `${MEDIA}/original-0123abcd.jpg`,
      localized: { ko: `${MEDIA}/ko-0123abcd.jpg`, en: `${MEDIA}/en-0123abcd.jpg`, zh: `${MEDIA}/zh-0123abcd.jpg` },
    },
    panorama: { panoId: "4MWo62oDv4KAFMmR86SRaA", pan: -75, tilt: 0, fov: 80 },
    guide: {
      places: [exitPlace()],
      walks: [{ from: "exit3", to: "stop", path: [{ ...EXIT }, { lat: 37.3657, lng: 127.10785 }, { ...STOP }] }],
    },
  };
}

function exitPlace(): Record<string, unknown> {
  return { id: "exit3", kind: "subwayExit", number: 3, name: { ko: "3번 출구", en: "Exit 3" }, coords: { ...EXIT } };
}

/** The valid stop with its guide replaced. */
function withGuide(guide: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...validStop(), guide, ...extra };
}

/** The valid stop's single walk with some fields replaced. */
function walk(fields: Record<string, unknown>) {
  return { from: "exit3", to: "stop", path: [{ ...EXIT }, { ...STOP }], ...fields };
}

const CAMPUS = { label: { ko: "자과캠" }, action: "alight", timing: "estimated" };

function catalog(stop: Record<string, unknown> = validStop(), sequences?: unknown) {
  return {
    stops: [stop],
    sequences: sequences ?? {
      "commute-jeongja": { up: [{ stopId: "jeongja-exit3", action: "board", timing: "scheduled" }, CAMPUS] },
    },
  };
}

/** One route type's sequence for commute-jeongja. */
function seq(...stops: unknown[]) {
  return { "commute-jeongja": { up: stops } };
}

describe("validateStopCatalog", () => {
  it("accepts the empty catalog and a complete stop", () => {
    // Act & Assert
    expect(validateStopCatalog({ stops: [], sequences: {} }, SERVICES)).toEqual([]);
    expect(validateStopCatalog(catalog(), SERVICES)).toEqual([]);
  });

  it("the committed catalog loaded without errors, estimates opt-ins included", () => {
    // The config would have thrown at import on any error; the file is checked
    // through the built config elsewhere.

    // Arrange
    const config = serviceConfig;

    // Assert
    expect(validateStopCatalog(stopCatalog, new Set(Object.keys(config)), etaOptIns(config))).toEqual([]);
    expect(subwayStationErrors(stopCatalog, SERVED_STATIONS)).toEqual([]);
    expect(stopCatalog.stops.length).toBeGreaterThan(0);
  });

  it("rejects a malformed root", () => {
    // Act & Assert
    expect(validateStopCatalog([], SERVICES)).toEqual(["bus-stops must be { stops: [], sequences: {} }"]);
  });

  it("rejects a duplicate stop id", () => {
    // Act
    const raw = { stops: [validStop(), validStop()], sequences: {} };

    // Assert
    expect(validateStopCatalog(raw, SERVICES)).toEqual(["stop jeongja-exit3: duplicate id"]);
  });

  it("rejects a stop without a Korean name", () => {
    // Act & Assert
    expect(validateStopCatalog(catalog({ ...validStop(), name: { en: "Jeongja" } }), SERVICES)).toEqual([
      "stop jeongja-exit3: name has no Korean text",
    ]);
  });

  it("rejects a blank translation", () => {
    // Act & Assert
    expect(validateStopCatalog(catalog({ ...validStop(), detail: { ko: "앞", zh: " " } }), SERVICES)).toEqual([
      "stop jeongja-exit3: detail has a blank zh text",
    ]);
  });

  it("rejects a photo original on another host", () => {
    // Act
    const stop = { ...validStop(), photo: { original: "https://example.com/a.jpg" } };

    // Assert
    expect(validateStopCatalog(catalog(stop), SERVICES)).toEqual(["stop jeongja-exit3: photo.original is not a media.skkuverse.com URL"]);
  });

  it("rejects a photo variant on another host", () => {
    // Act
    const stop = { ...validStop(), photo: { original: `${MEDIA}/o.jpg`, localized: { en: "https://media.skkuverse.com.evil.com/x.jpg" } } };

    // Assert
    expect(validateStopCatalog(catalog(stop), SERVICES)).toEqual(["stop jeongja-exit3: photo.localized.en is not a media.skkuverse.com URL"]);
  });

  it("rejects variants without an original", () => {
    // Act
    const stop = { ...validStop(), photo: { localized: { ko: `${MEDIA}/ko.jpg` } } };

    // Assert
    expect(validateStopCatalog(catalog(stop), SERVICES)).toEqual(["stop jeongja-exit3: photo has variants but no original"]);
  });

  it("rejects a variant for an unsupported language", () => {
    // Act
    const stop = { ...validStop(), photo: { original: `${MEDIA}/o.jpg`, localized: { ja: `${MEDIA}/ja.jpg` } } };

    // Assert
    expect(validateStopCatalog(catalog(stop), SERVICES)).toEqual(['stop jeongja-exit3: photo variant for unsupported language "ja"']);
  });

  it("rejects swapped coordinates", () => {
    // Act
    const stop = { ...validStop(), coords: { lat: STOP.lng, lng: STOP.lat } };

    // Assert
    expect(validateStopCatalog(catalog(stop), SERVICES)[0]).toBe(
      "stop jeongja-exit3: coords must be { lat, lng } inside South Korea (lat 33–39, lng 124–132)",
    );
  });

  it.each([
    [{ panoId: "short", pan: 0, tilt: 0, fov: 80 }, "panorama.panoId must be 22 characters"],
    [{ panoId: "4MWo62oDv4KAFMmR86SRa!", pan: 0, tilt: 0, fov: 80 }, "panorama.panoId must be 22 characters"],
    [{ panoId: "4MWo62oDv4KAFMmR86SRaA", pan: 1.5, tilt: 0, fov: 80 }, "panorama.pan must be an integer in -180..180"],
    [{ panoId: "4MWo62oDv4KAFMmR86SRaA", pan: 181, tilt: 0, fov: 80 }, "panorama.pan must be an integer in -180..180"],
    [{ panoId: "4MWo62oDv4KAFMmR86SRaA", pan: 0, tilt: -91, fov: 80 }, "panorama.tilt must be an integer in -90..90"],
    [{ panoId: "4MWo62oDv4KAFMmR86SRaA", pan: 0, tilt: 0, fov: 90 }, "panorama.fov must be an integer in 25..80"],
    [{ panoId: "4MWo62oDv4KAFMmR86SRaA", pan: 0, tilt: 0, fov: 24 }, "panorama.fov must be an integer in 25..80"],
  ])("rejects the panorama %j", (panorama, message) => {
    // Act
    const errors = validateStopCatalog(catalog({ ...validStop(), panorama }), SERVICES);

    // Assert
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(`stop jeongja-exit3: ${message}`);
  });

  it("accepts an empty guide (pin-only) and an exit marker with no walk", () => {
    // Act & Assert
    expect(validateStopCatalog(catalog(withGuide({})), SERVICES)).toEqual([]);
    expect(validateStopCatalog(catalog(withGuide({ places: [exitPlace()] })), SERVICES)).toEqual([]);
  });

  it("rejects a guide on a stop without coordinates", () => {
    // Arrange
    const stop = withGuide({});
    delete stop.coords;

    // Act & Assert
    expect(validateStopCatalog(catalog(stop), SERVICES)).toEqual(["stop jeongja-exit3: guide needs the stop's coordinates"]);
  });

  it("rejects a blank, repeated or reserved place id", () => {
    // Act & Assert
    expect(validateStopCatalog(catalog(withGuide({ places: [{ ...exitPlace(), id: " " }] })), SERVICES)).toEqual([
      "stop jeongja-exit3: guide.places[0] needs a non-empty id",
    ]);
    expect(validateStopCatalog(catalog(withGuide({ places: [exitPlace(), exitPlace()] })), SERVICES)).toEqual([
      "stop jeongja-exit3: guide.places[1]: duplicate place id exit3",
    ]);
    expect(validateStopCatalog(catalog(withGuide({ places: [{ ...exitPlace(), id: "stop" }] })), SERVICES)).toEqual([
      'stop jeongja-exit3: guide.places[0]: id "stop" is reserved for the stop itself',
    ]);
  });

  it("rejects a reserved or unknown place kind", () => {
    // Act & Assert
    for (const kind of ["place", "stop", undefined]) {
      expect(validateStopCatalog(catalog(withGuide({ places: [{ ...exitPlace(), kind }] })), SERVICES)).toEqual([
        `stop jeongja-exit3: guide.places[0]: kind must be "subwayExit", not ${JSON.stringify(kind)}`,
      ]);
    }
  });

  it.each([[0], [100], [1.5], ["3"]])("rejects the exit number %p", (number) => {
    // Act & Assert
    expect(validateStopCatalog(catalog(withGuide({ places: [{ ...exitPlace(), number }] })), SERVICES)).toEqual([
      "stop jeongja-exit3: guide.places[0]: number must be an integer in 1..99",
    ]);
  });

  it("rejects a place without a Korean name, or outside South Korea", () => {
    // Act & Assert
    expect(validateStopCatalog(catalog(withGuide({ places: [{ ...exitPlace(), name: { en: "Exit 3" } }] })), SERVICES)).toEqual([
      "stop jeongja-exit3: guide.places[0]: name has no Korean text",
    ]);
    expect(validateStopCatalog(catalog(withGuide({ places: [{ ...exitPlace(), coords: { lat: EXIT.lng, lng: EXIT.lat } }] })), SERVICES)).toEqual([
      "stop jeongja-exit3: guide.places[0]: coords must be { lat, lng } inside South Korea",
    ]);
  });

  it("rejects a walk of one point", () => {
    // Act
    const guide = { places: [exitPlace()], walks: [walk({ path: [{ ...EXIT }] })] };

    // Assert
    expect(validateStopCatalog(catalog(withGuide(guide)), SERVICES)).toEqual(["stop jeongja-exit3: guide.walks[0]: path must have at least two points"]);
  });

  it("rejects a walk that does not start at its from end", () => {
    // Act
    const guide = { places: [exitPlace()], walks: [walk({ path: [{ lat: 37.3659, lng: 127.1077 }, { ...STOP }] })] };

    // Assert
    expect(validateStopCatalog(catalog(withGuide(guide)), SERVICES)).toEqual(["stop jeongja-exit3: guide.walks[0]: path must start at exit3's coordinates"]);
  });

  it("rejects a walk that does not end at its to end", () => {
    // Act
    const guide = { places: [exitPlace()], walks: [walk({ path: [{ ...EXIT }, { lat: 37.3655, lng: 127.1079 }] })] };

    // Assert
    expect(validateStopCatalog(catalog(withGuide(guide)), SERVICES)).toEqual(["stop jeongja-exit3: guide.walks[0]: path must end at stop's coordinates"]);
  });

  it('rejects a walk without exactly one "stop" end', () => {
    // Act & Assert
    for (const ends of [{ from: "exit3", to: "exit3" }, { from: "stop", to: "stop" }]) {
      const guide = { places: [exitPlace()], walks: [walk(ends)] };
      expect(validateStopCatalog(catalog(withGuide(guide)), SERVICES)).toEqual(['stop jeongja-exit3: guide.walks[0] must have exactly one "stop" end']);
    }
  });

  it("rejects a walk to a place the stop does not have", () => {
    // Act
    const guide = { places: [exitPlace()], walks: [walk({ from: "exit4" })] };

    // Assert
    expect(validateStopCatalog(catalog(withGuide(guide)), SERVICES)).toEqual(['stop jeongja-exit3: guide.walks[0]: "exit4" is not a place of this stop']);
  });

  it("rejects a walk longer than 500 m (620 m)", () => {
    // Arrange
    const far = { lat: 37.371498, lng: EXIT.lng }; // 620 m north of the exit

    // Act
    const guide = { places: [exitPlace()], walks: [walk({ path: [{ ...EXIT }, far] })] };

    // Assert
    expect(validateStopCatalog(catalog(withGuide(guide, { coords: far })), SERVICES)).toEqual([
      "stop jeongja-exit3: guide.walks[0]: path is 620 m, longer than 500 m",
    ]);
  });

  it("rejects the legacy exit and walkPath fields, saying they moved to guide", () => {
    // Act & Assert
    expect(validateStopCatalog(catalog({ ...validStop(), walkPath: [{ ...EXIT }, { ...STOP }] }), SERVICES)).toEqual([
      "stop jeongja-exit3: walkPath moved to guide (guide.places and guide.walks)",
    ]);
    expect(validateStopCatalog(catalog({ ...validStop(), exit: { number: 3, coords: { ...EXIT } } }), SERVICES)).toEqual([
      "stop jeongja-exit3: exit moved to guide (guide.places and guide.walks)",
    ]);
  });

  const BOARD = { stopId: "jeongja-exit3", action: "board", timing: "scheduled" };

  it("rejects a sequence naming an unknown stop, naming the service and the id", () => {
    // Act
    const raw = catalog(validStop(), seq({ ...BOARD, stopId: "nowhere" }, CAMPUS));

    // Assert
    expect(validateStopCatalog(raw, SERVICES)).toEqual(['sequences commute-jeongja.up[0]: unknown stop id "nowhere"']);
  });

  it("rejects sequences for an unknown service", () => {
    // Act
    const raw = catalog(validStop(), { "commute-typo": { up: [BOARD, CAMPUS] } });

    // Assert
    expect(validateStopCatalog(raw, SERVICES)).toEqual(["sequences commute-typo: unknown service"]);
  });

  it("rejects a sequence of one stop", () => {
    // Act & Assert
    expect(validateStopCatalog(catalog(validStop(), seq(BOARD)), SERVICES)).toEqual([
      "sequences commute-jeongja.up: must list at least two stops",
    ]);
  });

  it("rejects a stop with both or neither of stopId and label", () => {
    // Arrange
    const both = { ...CAMPUS, stopId: "jeongja-exit3" };

    // Act
    const neither = { action: "alight", timing: "estimated" };

    // Assert
    for (const bad of [both, neither]) {
      expect(validateStopCatalog(catalog(validStop(), seq(BOARD, bad)), SERVICES)).toEqual([
        "sequences commute-jeongja.up[1]: needs exactly one of stopId and label",
      ]);
    }
  });

  it("rejects the same catalog stop twice in one sequence", () => {
    // Act & Assert
    expect(validateStopCatalog(catalog(validStop(), seq(BOARD, BOARD, CAMPUS)), SERVICES)).toEqual([
      "sequences commute-jeongja.up[1]: stop jeongja-exit3 appears twice",
    ]);
  });

  it("rejects an unknown action or timing", () => {
    // Act & Assert
    expect(validateStopCatalog(catalog(validStop(), seq({ ...BOARD, action: "stop" }, CAMPUS)), SERVICES)).toContain(
      'sequences commute-jeongja.up[0]: action must be "board" or "alight"',
    );
    expect(validateStopCatalog(catalog(validStop(), seq(BOARD, { ...CAMPUS, timing: "approx" })), SERVICES)).toEqual([
      'sequences commute-jeongja.up[1]: timing must be "scheduled" or "estimated"',
    ]);
  });

  it("rejects a run that does not start by boarding, or never lets anyone off", () => {
    // Act & Assert
    expect(validateStopCatalog(catalog(validStop(), seq(CAMPUS, BOARD)), SERVICES)).toEqual([
      "sequences commute-jeongja.up: the first stop must be a boarding stop",
    ]);
    const second = { label: { ko: "다른 정류장" }, action: "board", timing: "scheduled" };
    expect(validateStopCatalog(catalog(validStop(), seq(BOARD, second)), SERVICES)).toEqual([
      "sequences commute-jeongja.up: must have at least one alighting stop",
    ]);
  });

  it("accepts a run that boards at two stops (the 강남·양재 shape)", () => {
    // Arrange
    const second: Record<string, unknown> = { ...validStop(), id: "second-stop" };

    // Act
    const raw = {
      stops: [validStop(), second],
      sequences: seq(BOARD, { stopId: "second-stop", action: "board", timing: "scheduled" }, CAMPUS),
    };

    // Assert
    expect(validateStopCatalog(raw, SERVICES)).toEqual([]);
  });

  it("rejects a note without Korean text", () => {
    // Act & Assert
    expect(validateStopCatalog(catalog(validStop(), seq({ ...BOARD, note: { en: "Board · Jeongja" } }, CAMPUS)), SERVICES)).toEqual([
      "sequences commute-jeongja.up[0]: note has no Korean text",
    ]);
  });

  it("rejects a label or detail without Korean text", () => {
    // Act & Assert
    expect(validateStopCatalog(catalog(validStop(), seq(BOARD, { ...CAMPUS, label: { en: "NSC" } })), SERVICES)).toEqual([
      "sequences commute-jeongja.up[1]: label has no Korean text",
    ]);
    expect(validateStopCatalog(catalog(validStop(), seq(BOARD, { ...CAMPUS, detail: { ko: " " } })), SERVICES)).toEqual([
      "sequences commute-jeongja.up[1]: detail has no Korean text",
    ]);
  });

  describe("walk direction matches how the stop is used", () => {
    const ALIGHT = { stopId: "jeongja-exit3", action: "alight", timing: "estimated" };
    const NSC_BOARD = { label: { ko: "N센터 건너편" }, action: "board", timing: "scheduled" };
    const dropOff = () =>
      withGuide({ places: [exitPlace()], walks: [walk({ from: "stop", to: "exit3", path: [{ ...STOP }, { ...EXIT }] })] });

    it("rejects a walk to the stop where some sequence alights, naming the stop and the sequence", () => {
      // Act
      const raw = catalog(validStop(), { "commute-jeongja": { up: [BOARD, CAMPUS], down: [NSC_BOARD, ALIGHT] } });

      // Assert
      expect(validateStopCatalog(raw, SERVICES)).toEqual([
        "sequences commute-jeongja.down[1]: stop jeongja-exit3 has a walk to the stop (boarding), but this sequence alights there",
      ]);
    });

    it("rejects a walk from the stop where some sequence boards", () => {
      // Act & Assert
      expect(validateStopCatalog(catalog(dropOff()), SERVICES)).toEqual([
        "sequences commute-jeongja.up[0]: stop jeongja-exit3 has a walk from the stop (alighting), but this sequence boards there",
      ]);
    });

    it("accepts a walk from a drop-off, and a stop used both ways with no walk", () => {
      // Act & Assert
      expect(validateStopCatalog(catalog(dropOff(), seq(NSC_BOARD, ALIGHT)), SERVICES)).toEqual([]);
      const both = withGuide({ places: [exitPlace()] });
      expect(validateStopCatalog(catalog(both, { "commute-jeongja": { up: [BOARD, CAMPUS], down: [NSC_BOARD, ALIGHT] } }), SERVICES)).toEqual([]);
    });
  });
  describe("sequences opted in to arrival estimates", () => {
    const UP = new Map([["commute-jeongja", ["up"]]]);
    const errorsWithEta = (raw: unknown, optIns: Map<string, string[]> = UP) => validateStopCatalog(raw, SERVICES, optIns);

    it("Opted-in sequence without coordinates: names the service, the route type and the stop", () => {
      // Arrange
      const noCoords: Record<string, unknown> = { ...validStop() };
      delete noCoords.coords;
      delete noCoords.guide;
      const drop = { id: "drop", name: { ko: "하차" }, coords: { ...STOP } };

      // Act
      const raw = {
        stops: [noCoords, drop],
        sequences: seq(BOARD, { stopId: "drop", action: "alight", timing: "estimated" }),
      };

      // Assert
      expect(errorsWithEta(raw)).toEqual([
        "sequences commute-jeongja.up[0]: opted in to estimates, but stop jeongja-exit3 has no coordinates",
      ]);
    });

    it("refuses a label stop, which has no coordinates to route through", () => {
      // Act & Assert
      expect(errorsWithEta(catalog())).toEqual([
        "sequences commute-jeongja.up[1]: opted in to estimates, but is a label, not a catalog stop with coordinates",
      ]);
    });

    it("refuses an opt-in without a sequence, a sequence of more than 7 stops, no estimated stop, or an estimated start", () => {
      // Act & Assert
      expect(errorsWithEta(catalog(), new Map([["commute-jeongja", ["down"]]]))).toEqual([
        "sequences commute-jeongja.down: opted in to estimates but has no stop sequence",
      ]);
      const stops = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, name: { ko: `정류장 ${i}` }, coords: { ...STOP } }));
      const eight = stops.map((st, i) => ({
        stopId: st.id,
        action: i === 0 ? "board" : "alight",
        timing: i === 0 ? "scheduled" : "estimated",
      }));
      expect(errorsWithEta({ stops, sequences: seq(...eight) })).toEqual([
        "sequences commute-jeongja.up: opted in to estimates with 8 stops, more than 7",
      ]);
      const allScheduled = eight.slice(0, 2).map((st) => ({ ...st, timing: "scheduled" }));
      expect(errorsWithEta({ stops, sequences: seq(...allScheduled) })).toEqual([
        "sequences commute-jeongja.up: opted in to estimates, but has no estimated stop",
      ]);
      const estimatedStart = eight.slice(0, 2).map((st) => ({ ...st, timing: "estimated" }));
      expect(errorsWithEta({ stops, sequences: seq(...estimatedStart) })).toEqual([
        "sequences commute-jeongja.up: opted in to estimates, but its first stop is not scheduled",
      ]);
    });

    it("opts the commute shuttle in, 등교 and 하교, and the committed catalog passes: its 등교 runs end at a catalog stop", () => {
      // Act
      const optIns = etaOptIns(serviceConfig);

      // Assert
      expect(Object.fromEntries(optIns)).toEqual({
        "campus-inja": ["regular", "hakbu"],
        "campus-jain": ["regular", "hakbu"],
        "commute-jeongja": ["up", "down"],
        "commute-jamsil": ["up", "down"],
        "commute-dogok": ["up", "down"],
        "commute-gangnam-yangjae": ["up", "down"],
        "commute-gwanggyo": ["up", "down"],
      });
      expect(validateStopCatalog(stopCatalog, new Set(Object.keys(serviceConfig)), optIns)).toEqual([]);
    });
  });
});

describe("subwayStationErrors", () => {
  const STATIONS = new Set(["jeongja", "gangnam"]);
  const tagged = (subwayStationId: unknown) => catalog({ ...validStop(), subwayStationId });

  it("accepts a stop that names a served station by its slug, and a stop that names none", () => {
    // Act & Assert
    expect(subwayStationErrors(tagged("jeongja"), STATIONS)).toEqual([]);
    expect(subwayStationErrors(catalog(), STATIONS)).toEqual([]);
  });

  it("rejects a slug the subway registry does not serve, naming the stop and the value", () => {
    // Act & Assert
    expect(subwayStationErrors(tagged("jeongja2"), STATIONS)).toEqual(['stop jeongja-exit3: subwayStationId "jeongja2" is not a served subway station']);
    expect(subwayStationErrors(tagged("Jeongja"), STATIONS)).toEqual(['stop jeongja-exit3: subwayStationId "Jeongja" is not a served subway station']);
  });

  it("rejects a value that is not a string, naming the stop and the value", () => {
    // Act & Assert
    expect(subwayStationErrors(tagged(7), STATIONS)).toEqual(["stop jeongja-exit3: subwayStationId must be a station slug, not 7"]);
    expect(subwayStationErrors(tagged({ id: "jeongja" }), STATIONS)).toEqual([
      'stop jeongja-exit3: subwayStationId must be a station slug, not {"id":"jeongja"}',
    ]);
    expect(subwayStationErrors(tagged(null), STATIONS)).toEqual(["stop jeongja-exit3: subwayStationId must be a station slug, not null"]);
  });

  it("reports every bad stop, and leaves a malformed root or stop to validateStopCatalog", () => {
    // Arrange
    const raw = { stops: [{ ...validStop(), subwayStationId: "x" }, { subwayStationId: "z" }, { id: "b", name: {}, subwayStationId: "y" }], sequences: {} };

    // Act & Assert
    expect(subwayStationErrors(raw, STATIONS)).toEqual([
      'stop jeongja-exit3: subwayStationId "x" is not a served subway station',
      'stop b: subwayStationId "y" is not a served subway station',
    ]);
    expect(subwayStationErrors([], STATIONS)).toEqual([]);
  });
});

describe("toBusStopsIssues", () => {
  const LANE: LaneStrategies = {
    "campus-inja": { regular: { strategy: "busLane", direction: "southbound" } },
  };

  const context = {
    knownServiceIds: new Set(Object.keys(serviceConfig)),
    optIns: etaOptIns(serviceConfig),
    stationIds: SERVED_STATIONS,
    laneStrategies: LANE,
  };

  // The fixture as untyped JSON, so a test can break it.
  const fixture = (): Record<string, any> => busStopsFixture();

  const indexOfStop = (data: Record<string, any>, id: string): number => data.stops.findIndex((stop: { id: string }) => stop.id === id);

  function withStop(id: string, patch: Record<string, unknown>): Record<string, any> {
    const data = fixture();
    const index = indexOfStop(data, id);
    data.stops[index] = { ...data.stops[index], ...patch };
    return data;
  }

  it("finds no issue in revision 1", () => {
    // Act & Assert
    expect(toBusStopsIssues(fixture() as BusStopsData, context)).toEqual([]);
  });

  it("Unknown stop referenced: names the service, the route type and the missing stop id", () => {
    // Arrange
    const data = fixture();
    data.sequences["commute-gangnam-yangjae"].down[1].stopId = "yangjae-exit9";

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([
      { path: ["sequences", "commute-gangnam-yangjae", "down", 1], message: 'sequences commute-gangnam-yangjae.down[1]: unknown stop id "yangjae-exit9"' },
    ]);
  });

  it("Coordinates swapped: names the stop", () => {
    // Arrange
    const data = fixture();
    const index = indexOfStop(data, "jeongja-exit3");
    const { lat, lng } = data.stops[index].coords;
    data.stops[index].coords = { lat: lng, lng: lat };

    // Act
    const issues = toBusStopsIssues(data as BusStopsData, context);

    // Assert
    const atStop = issues.filter((issue) => issue.path.join(".") === `stops.${index}`);
    expect(atStop).toHaveLength(1);
    expect(atStop[0]!.message.split("; ")).toContain("stop jeongja-exit3: coords must be { lat, lng } inside South Korea (lat 33–39, lng 124–132)");
  });

  it("names every fault of one stop in the one issue at its path: bad coordinates, an off-host photo and a fov of 90", () => {
    // Arrange
    const data = fixture();
    const index = indexOfStop(data, "jeongja-exit3");
    const stop = data.stops[index];
    data.stops[index] = { ...stop, coords: { lat: stop.coords.lng, lng: stop.coords.lat }, photo: { original: "https://example.com/stop.jpg" }, panorama: { ...stop.panorama, fov: 90 } };

    // Act
    const atStop = toBusStopsIssues(data as BusStopsData, context).filter((issue) => issue.path.join(".") === `stops.${index}`);

    // Assert
    expect(atStop).toHaveLength(1);
    expect(atStop[0]!.message.split("; ")).toEqual(
      expect.arrayContaining([
        "stop jeongja-exit3: coords must be { lat, lng } inside South Korea (lat 33–39, lng 124–132)",
        "stop jeongja-exit3: photo.original is not a media.skkuverse.com URL",
        "stop jeongja-exit3: panorama.fov must be an integer in 25..80",
      ]),
    );
  });

  it("Photo on another host: names the stop", () => {
    // Arrange
    const data = withStop("jamsil-exit4", { photo: { original: "https://example.com/stop.jpg" } });

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([{ path: ["stops", indexOfStop(data, "jamsil-exit4")], message: "stop jamsil-exit4: photo.original is not a media.skkuverse.com URL" }]);
  });

  it.each([
    [79, []],
    [80, []],
    [81, ["stop dogok-exit1: panorama.fov must be an integer in 25..80"]],
    [90, ["stop dogok-exit1: panorama.fov must be an integer in 25..80"]],
  ])("Field of view out of range: a panorama fov of %i gives %j", (fov, messages) => {
    // Arrange
    const data = fixture();
    const index = indexOfStop(data, "dogok-exit1");
    data.stops[index].panorama = { ...data.stops[index].panorama, fov };

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual(messages.map((message) => ({ path: ["stops", index], message })));
  });

  it("A run nobody leaves: names the service and the route type", () => {
    // Arrange
    const data = fixture();
    for (const entry of data.sequences["campus-jain"].hakbu) entry.action = "board";

    // Act
    const issues = toBusStopsIssues(data as BusStopsData, context);

    // Assert
    expect(issues).toContainEqual({ path: ["sequences", "campus-jain", "hakbu"], message: "sequences campus-jain.hakbu: must have at least one alighting stop" });
  });

  it("Legacy fields left in the catalog: says the walk moved to guide", () => {
    // Arrange
    const data = withStop("gangnam-exit5", { walkPath: [] });

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([{ path: ["stops", indexOfStop(data, "gangnam-exit5")], message: "stop gangnam-exit5: walkPath moved to guide (guide.places and guide.walks)" }]);
  });

  it("Unknown station stops the boot: names jeongja-exit2 and \"jeongja2\" at its station's path", () => {
    // Arrange
    const data = withStop("jeongja-exit2", { subwayStationId: "jeongja2" });

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([
      { path: ["stops", indexOfStop(data, "jeongja-exit2"), "subwayStationId"], message: 'stop jeongja-exit2: subwayStationId "jeongja2" is not a served subway station' },
    ]);
  });

  it("reports a catalog issue beside a station issue, in one run", () => {
    // Arrange
    const data = withStop("jeongja-exit2", { subwayStationId: "jeongja2", name: {} });
    const index = indexOfStop(data, "jeongja-exit2");

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([
      { path: ["stops", index], message: "stop jeongja-exit2: name has no Korean text" },
      { path: ["stops", index, "subwayStationId"], message: 'stop jeongja-exit2: subwayStationId "jeongja2" is not a served subway station' },
    ]);
  });

  it("Two stops share an id: names the later one", () => {
    // Arrange
    const data = fixture();
    data.stops.push({ ...data.stops[0] });

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([{ path: ["stops", data.stops.length - 1], message: "stop jeongja-exit3: duplicate id" }]);
  });

  it("Opted-in sequence without coordinates: names the service, the route type and the stop", () => {
    // Arrange
    const data = withStop("nsc-n-center", { coords: undefined });
    delete data.stops[indexOfStop(data, "nsc-n-center")].coords;

    // Act
    const issues = toBusStopsIssues(data as BusStopsData, context);

    // Assert
    expect(issues).toContainEqual({ path: ["sequences", "campus-inja", "regular", 1], message: "sequences campus-inja.regular[1]: opted in to estimates, but stop nsc-n-center has no coordinates" });
  });

  it("Strategy for an unknown sequence: names the sequence the strategy is set for", () => {
    // Arrange
    const data = fixture();
    delete data.sequences["campus-inja"].regular;

    // Act
    const issues = toBusStopsIssues(data as BusStopsData, context);

    // Assert
    expect(issues).toContainEqual({
      path: ["sequences", "campus-inja", "regular"],
      message: '"campus-inja regular" has a travel strategy in src/bus/eta/lane/bus-eta-lane.constants.ts, but this data does not estimate it',
    });
  });

  it("finds no lane issue for a strategy on an estimated sequence, and one for a sequence the code does not opt in", () => {
    // Arrange
    const strategies: LaneStrategies = { ...LANE, "fasttrack-inja": { regular: { strategy: "car" } } };

    // Act & Assert
    expect(toBusStopsIssues(fixture() as BusStopsData, { ...context, laneStrategies: strategies })).toEqual([
      {
        path: ["sequences", "fasttrack-inja", "regular"],
        message: '"fasttrack-inja regular" has a travel strategy in src/bus/eta/lane/bus-eta-lane.constants.ts, but this data does not estimate it',
      },
    ]);
  });

  it.each([
    [0, []],
    [1, [{ path: ["hssc", "stations", 1, "isFirstStation"], message: "only the first position may be the first station" }]],
    [10, [{ path: ["hssc", "stations", 10, "isFirstStation"], message: "only the first position may be the first station" }]],
  ])("an HSSC position %i flagged first gives %j", (index, expected) => {
    // Arrange
    const data = fixture();
    data.hssc.stations[index].isFirstStation = true;

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual(expected);
  });

  it.each([
    [10, []],
    [9, [{ path: ["hssc", "stations", 9, "isLastStation"], message: "only the last position may be the last station" }]],
    [0, [{ path: ["hssc", "stations", 0, "isLastStation"], message: "only the last position may be the last station" }]],
  ])("an HSSC position %i flagged last gives %j", (index, expected) => {
    // Arrange
    const data = fixture();
    data.hssc.stations[index].isLastStation = true;

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual(expected);
  });

  it("Unknown stop: names the HSSC position's path and the id", () => {
    // Arrange
    const data = fixture();
    data.stops.splice(indexOfStop(data, "hssc-main-gate-in"), 1);

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([{ path: ["hssc", "stations", 9, "stopId"], message: 'names the stop "hssc-main-gate-in", which the dataset\'s stops do not hold' }]);
  });

  it("Main gate inbound and outbound: two positions naming one stop name the later one", () => {
    // Arrange
    const data = fixture();
    data.hssc.stations[9].stopId = data.hssc.stations[2].stopId;

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([{ path: ["hssc", "stations", 9, "stopId"], message: 'names the stop "hssc-main-gate-out", which position 2 names too' }]);
  });

  // WHY: a null stopId is served as a pass-through on /bus/config while the HSSC estimates count stops by the code's pass-through
  // positions, so the two must agree (ADR 0019 D4).
  it("Position 4 left null: names its path, since the estimates count it as a stop", () => {
    // Arrange
    const data = fixture();
    data.hssc.stations[4].stopId = null;

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([
      { path: ["hssc", "stations", 4, "stopId"], message: "is null, but the HSSC estimates count position 4 as a stop (isHsscPassThrough in src/bus/bus.rules.ts)" },
    ]);
  });

  it("Position 5 given a stop: names its path and the stop, since the estimates pass it through", () => {
    // Arrange
    const data = fixture();
    data.hssc.stations[5].stopId = "hssc-bus-lot";

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([
      {
        path: ["hssc", "stations", 5, "stopId"],
        message: 'names the stop "hssc-bus-lot" at position 5, which the HSSC estimates pass through (isHsscPassThrough in src/bus/bus.rules.ts)',
      },
    ]);
  });

  it("One pole claimed twice: names both paths and 01618", () => {
    // Arrange
    const data = withStop("hssc-bus-lot", { arsIds: ["01618"] });
    const owner = indexOfStop(data, "hssc-bus-lot");
    const other = indexOfStop(data, "hssc-student-center");
    data.stops[other] = { ...data.stops[other], arsIds: ["01618"] };

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([{ path: ["stops", other, "arsIds", 0], message: `ARS number 01618 is aliased by stops.${owner}.arsIds.0 too` }]);
  });

  it("passes two stops aliasing two different ARS numbers", () => {
    // Arrange
    const data = withStop("hssc-bus-lot", { arsIds: ["01618"] });
    const other = indexOfStop(data, "hssc-600th");
    data.stops[other] = { ...data.stops[other], arsIds: ["01616"] };

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([]);
  });

  it("One TOPIS station claimed twice: names the second path and 200000162", () => {
    // Arrange
    const data = withStop("hssc-bus-lot", { topisIds: ["200000162"] });
    const owner = indexOfStop(data, "hssc-bus-lot");
    const other = indexOfStop(data, "hssc-student-center");
    data.stops[other] = { ...data.stops[other], topisIds: ["200000159", "200000162"] };

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([{ path: ["stops", other, "topisIds", 1], message: `TOPIS station 200000162 is aliased by stops.${owner}.topisIds.0 too` }]);
  });

  it("passes two stops aliasing the two 성균관대학교 poles by TOPIS station, and an ARS alias beside them", () => {
    // Arrange
    const data = withStop("hssc-bus-lot", { topisIds: ["200000162"], arsIds: ["01618"] });
    const other = indexOfStop(data, "hssc-600th");
    data.stops[other] = { ...data.stops[other], topisIds: ["200000159"] };

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([]);
  });

  it("names an overlay entry's subway station the checked-out code does not serve", () => {
    // Arrange
    const data: Record<string, any> = { ...fixture(), topis: { "01592": { subwayStationId: "hyehwa" }, "01876": { subwayStationId: "hyehwa4" } } };

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([{ path: ["topis", "01876", "subwayStationId"], message: '"hyehwa4" is not a served subway station' }]);
  });

  describe("a served stop needs coordinates", () => {
    const servedWithoutCoords = (stopId: string) =>
      `stop ${stopId}: has no coords, but the HSSC line, a sequence or its arsIds serve it, and the app opens only a stop it can place on its map`;

    it("Served HSSC stop without coordinates: names its coords path", () => {
      // Arrange
      const data = fixture();
      const index = indexOfStop(data, "hssc-olympic-hall");
      delete data.stops[index].coords;

      // Act & Assert
      expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([{ path: ["stops", index, "coords"], message: servedWithoutCoords("hssc-olympic-hall") }]);
    });

    it("Served sequence stop without coordinates: names its coords path beside the estimate issue", () => {
      // Arrange
      const data = fixture();
      const index = indexOfStop(data, "gangnam-median");
      delete data.stops[index].coords;
      delete data.stops[index].guide;

      // Act
      const issues = toBusStopsIssues(data as BusStopsData, context);

      // Assert
      expect(issues.filter((issue) => issue.path.at(-1) === "coords")).toEqual([{ path: ["stops", index, "coords"], message: servedWithoutCoords("gangnam-median") }]);
    });

    it("Aliasing stop without coordinates: names its coords path, though no line or sequence names it", () => {
      // Arrange
      const data = fixture();
      data.stops.push({ id: "hssc-new-pole", name: { ko: "새 정류장" }, arsIds: ["01618"] });

      // Act & Assert
      expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([{ path: ["stops", data.stops.length - 1, "coords"], message: servedWithoutCoords("hssc-new-pole") }]);
    });

    it("accepts the same aliasing stop with coordinates", () => {
      // Arrange
      const data = fixture();
      data.stops.push({ id: "hssc-new-pole", name: { ko: "새 정류장" }, arsIds: ["01618"], coords: { lat: 37.587, lng: 126.993 } });

      // Act & Assert
      expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([]);
    });

    it("Stop aliasing a TOPIS station without coordinates: names its coords path and its topisIds", () => {
      // Arrange
      const data = fixture();
      data.stops.push({ id: "nsc-skku-to-sadang", name: { ko: "성균관대학교" }, topisIds: ["200000162"] });

      // Act & Assert
      expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([
        {
          path: ["stops", data.stops.length - 1, "coords"],
          message: "stop nsc-skku-to-sadang: has no coords, but the HSSC line, a sequence or its topisIds serve it, and the app opens only a stop it can place on its map",
        },
      ]);
    });

    it("accepts a stop nothing serves without coordinates: no line, no sequence and an empty arsIds", () => {
      // Arrange
      const data = fixture();
      data.stops.push({ id: "hssc-spare", name: { ko: "예비 정류장" } }, { id: "hssc-spare-alias", name: { ko: "예비 별칭" }, arsIds: [] });

      // Act & Assert
      expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([]);
    });
  });
});

describe("storedLineAndAliasErrors", () => {
  const fixture = (): Record<string, any> => busStopsFixture();

  it("finds none in revision 1, whose overlay and lane fit are not its checks", () => {
    // Arrange
    const data: Record<string, any> = { ...fixture(), topis: { "01876": { subwayStationId: "hyehwa4" } } };

    // Act & Assert
    expect(storedLineAndAliasErrors(data as BusStopsData)).toEqual([]);
  });

  it("names each HSSC line and alias issue at its path", () => {
    // Arrange
    const data = fixture();
    data.hssc.stations[0].stopId = "hssc-nowhere";
    data.stops[0].arsIds = ["01618"];
    data.stops[1].arsIds = ["01618"];

    // Act & Assert
    expect(storedLineAndAliasErrors(data as BusStopsData)).toEqual([
      'hssc.stations.0.stopId: names the stop "hssc-nowhere", which the dataset\'s stops do not hold',
      "stops.1.arsIds.0: ARS number 01618 is aliased by stops.0.arsIds.0 too",
    ]);
  });

  it("leaves a served stop without coordinates to the push, since a stop list serves it with coords null", () => {
    // Arrange
    const data = fixture();
    delete data.stops.find((stop: { id: string }) => stop.id === "hssc-olympic-hall").coords;

    // Act & Assert
    expect(storedLineAndAliasErrors(data as BusStopsData)).toEqual([]);
  });
});
