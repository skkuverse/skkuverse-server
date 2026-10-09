/**
 * The boarding-stop catalog validator (stops and stop sequences): one case per rule in the
 * bus-schedule-config spec, each asserting the error names its stop or
 * service. The committed catalog itself is checked against the built config in
 * bus-config.service.test.ts.
 */
import { stopCatalog, validateStopCatalog } from "../../../src/bus/schedule/schedule-stops";

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

function errorsFor(raw: unknown): string[] {
  return validateStopCatalog(raw, SERVICES);
}

describe("validateStopCatalog", () => {
  it("accepts the empty catalog and a complete stop", () => {
    expect(errorsFor({ stops: [], sequences: {} })).toEqual([]);
    expect(errorsFor(catalog())).toEqual([]);
  });

  it("the committed catalog loaded without errors", () => {
    // The module would have exited (or, under test, served an empty catalog)
    // on any error; the file is checked through the built config elsewhere.
    expect(validateStopCatalog(stopCatalog, new Set(Object.keys(require("../../../src/bus/schedule/service-config").default)))).toEqual([]);
  });

  it("rejects a malformed root", () => {
    expect(errorsFor([])).toEqual(["schedule-stops.json must be { stops: [], sequences: {} }"]);
  });

  it("rejects a duplicate stop id", () => {
    const raw = { stops: [validStop(), validStop()], sequences: {} };
    expect(errorsFor(raw)).toEqual(["stop jeongja-exit3: duplicate id"]);
  });

  it("rejects a stop without a Korean name", () => {
    expect(errorsFor(catalog({ ...validStop(), name: { en: "Jeongja" } }))).toEqual([
      "stop jeongja-exit3: name has no Korean text",
    ]);
  });

  it("rejects a blank translation", () => {
    expect(errorsFor(catalog({ ...validStop(), detail: { ko: "앞", zh: " " } }))).toEqual([
      "stop jeongja-exit3: detail has a blank zh text",
    ]);
  });

  it("rejects a photo original on another host", () => {
    const stop = { ...validStop(), photo: { original: "https://example.com/a.jpg" } };
    expect(errorsFor(catalog(stop))).toEqual(["stop jeongja-exit3: photo.original is not a media.skkuverse.com URL"]);
  });

  it("rejects a photo variant on another host", () => {
    const stop = { ...validStop(), photo: { original: `${MEDIA}/o.jpg`, localized: { en: "https://media.skkuverse.com.evil.com/x.jpg" } } };
    expect(errorsFor(catalog(stop))).toEqual(["stop jeongja-exit3: photo.localized.en is not a media.skkuverse.com URL"]);
  });

  it("rejects variants without an original", () => {
    const stop = { ...validStop(), photo: { localized: { ko: `${MEDIA}/ko.jpg` } } };
    expect(errorsFor(catalog(stop))).toEqual(["stop jeongja-exit3: photo has variants but no original"]);
  });

  it("rejects a variant for an unsupported language", () => {
    const stop = { ...validStop(), photo: { original: `${MEDIA}/o.jpg`, localized: { ja: `${MEDIA}/ja.jpg` } } };
    expect(errorsFor(catalog(stop))).toEqual(['stop jeongja-exit3: photo variant for unsupported language "ja"']);
  });

  it("rejects swapped coordinates", () => {
    const stop = { ...validStop(), coords: { lat: STOP.lng, lng: STOP.lat } };
    expect(errorsFor(catalog(stop))[0]).toBe(
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
    const errors = errorsFor(catalog({ ...validStop(), panorama }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(`stop jeongja-exit3: ${message}`);
  });

  it("accepts an empty guide (pin-only) and an exit marker with no walk", () => {
    expect(errorsFor(catalog(withGuide({})))).toEqual([]);
    expect(errorsFor(catalog(withGuide({ places: [exitPlace()] })))).toEqual([]);
  });

  it("rejects a guide on a stop without coordinates", () => {
    const stop = withGuide({});
    delete stop.coords;
    expect(errorsFor(catalog(stop))).toEqual(["stop jeongja-exit3: guide needs the stop's coordinates"]);
  });

  it("rejects a blank, repeated or reserved place id", () => {
    expect(errorsFor(catalog(withGuide({ places: [{ ...exitPlace(), id: " " }] })))).toEqual([
      "stop jeongja-exit3: guide.places[0] needs a non-empty id",
    ]);
    expect(errorsFor(catalog(withGuide({ places: [exitPlace(), exitPlace()] })))).toEqual([
      "stop jeongja-exit3: guide.places[1]: duplicate place id exit3",
    ]);
    expect(errorsFor(catalog(withGuide({ places: [{ ...exitPlace(), id: "stop" }] })))).toEqual([
      'stop jeongja-exit3: guide.places[0]: id "stop" is reserved for the stop itself',
    ]);
  });

  it("rejects a reserved or unknown place kind", () => {
    for (const kind of ["place", "stop", undefined]) {
      expect(errorsFor(catalog(withGuide({ places: [{ ...exitPlace(), kind }] })))).toEqual([
        `stop jeongja-exit3: guide.places[0]: kind must be "subwayExit", not ${JSON.stringify(kind)}`,
      ]);
    }
  });

  it.each([[0], [100], [1.5], ["3"]])("rejects the exit number %p", (number) => {
    expect(errorsFor(catalog(withGuide({ places: [{ ...exitPlace(), number }] })))).toEqual([
      "stop jeongja-exit3: guide.places[0]: number must be an integer in 1..99",
    ]);
  });

  it("rejects a place without a Korean name, or outside South Korea", () => {
    expect(errorsFor(catalog(withGuide({ places: [{ ...exitPlace(), name: { en: "Exit 3" } }] })))).toEqual([
      "stop jeongja-exit3: guide.places[0]: name has no Korean text",
    ]);
    expect(errorsFor(catalog(withGuide({ places: [{ ...exitPlace(), coords: { lat: EXIT.lng, lng: EXIT.lat } }] })))).toEqual([
      "stop jeongja-exit3: guide.places[0]: coords must be { lat, lng } inside South Korea",
    ]);
  });

  it("rejects a walk of one point", () => {
    const guide = { places: [exitPlace()], walks: [walk({ path: [{ ...EXIT }] })] };
    expect(errorsFor(catalog(withGuide(guide)))).toEqual(["stop jeongja-exit3: guide.walks[0]: path must have at least two points"]);
  });

  it("rejects a walk that does not start at its from end", () => {
    const guide = { places: [exitPlace()], walks: [walk({ path: [{ lat: 37.3659, lng: 127.1077 }, { ...STOP }] })] };
    expect(errorsFor(catalog(withGuide(guide)))).toEqual(["stop jeongja-exit3: guide.walks[0]: path must start at exit3's coordinates"]);
  });

  it("rejects a walk that does not end at its to end", () => {
    const guide = { places: [exitPlace()], walks: [walk({ path: [{ ...EXIT }, { lat: 37.3655, lng: 127.1079 }] })] };
    expect(errorsFor(catalog(withGuide(guide)))).toEqual(["stop jeongja-exit3: guide.walks[0]: path must end at stop's coordinates"]);
  });

  it('rejects a walk without exactly one "stop" end', () => {
    for (const ends of [{ from: "exit3", to: "exit3" }, { from: "stop", to: "stop" }]) {
      const guide = { places: [exitPlace()], walks: [walk(ends)] };
      expect(errorsFor(catalog(withGuide(guide)))).toEqual(['stop jeongja-exit3: guide.walks[0] must have exactly one "stop" end']);
    }
  });

  it("rejects a walk to a place the stop does not have", () => {
    const guide = { places: [exitPlace()], walks: [walk({ from: "exit4" })] };
    expect(errorsFor(catalog(withGuide(guide)))).toEqual(['stop jeongja-exit3: guide.walks[0]: "exit4" is not a place of this stop']);
  });

  it("rejects a walk longer than 500 m (spec scenario: 620 m)", () => {
    const far = { lat: 37.371498, lng: EXIT.lng }; // 620 m north of the exit
    const guide = { places: [exitPlace()], walks: [walk({ path: [{ ...EXIT }, far] })] };
    expect(errorsFor(catalog(withGuide(guide, { coords: far })))).toEqual([
      "stop jeongja-exit3: guide.walks[0]: path is 620 m, longer than 500 m",
    ]);
  });

  it("rejects the legacy exit and walkPath fields, saying they moved to guide", () => {
    expect(errorsFor(catalog({ ...validStop(), walkPath: [{ ...EXIT }, { ...STOP }] }))).toEqual([
      "stop jeongja-exit3: walkPath moved to guide (guide.places and guide.walks)",
    ]);
    expect(errorsFor(catalog({ ...validStop(), exit: { number: 3, coords: { ...EXIT } } }))).toEqual([
      "stop jeongja-exit3: exit moved to guide (guide.places and guide.walks)",
    ]);
  });

  const BOARD = { stopId: "jeongja-exit3", action: "board", timing: "scheduled" };

  it("rejects a sequence naming an unknown stop, naming the service and the id", () => {
    const raw = catalog(validStop(), seq({ ...BOARD, stopId: "nowhere" }, CAMPUS));
    expect(errorsFor(raw)).toEqual(['sequences commute-jeongja.up[0]: unknown stop id "nowhere"']);
  });

  it("rejects sequences for an unknown service", () => {
    const raw = catalog(validStop(), { "commute-typo": { up: [BOARD, CAMPUS] } });
    expect(errorsFor(raw)).toEqual(["sequences commute-typo: unknown service"]);
  });

  it("rejects a sequence of one stop", () => {
    expect(errorsFor(catalog(validStop(), seq(BOARD)))).toEqual([
      "sequences commute-jeongja.up: must list at least two stops",
    ]);
  });

  it("rejects a stop with both or neither of stopId and label", () => {
    const both = { ...CAMPUS, stopId: "jeongja-exit3" };
    const neither = { action: "alight", timing: "estimated" };
    for (const bad of [both, neither]) {
      expect(errorsFor(catalog(validStop(), seq(BOARD, bad)))).toEqual([
        "sequences commute-jeongja.up[1]: needs exactly one of stopId and label",
      ]);
    }
  });

  it("rejects the same catalog stop twice in one sequence", () => {
    expect(errorsFor(catalog(validStop(), seq(BOARD, BOARD, CAMPUS)))).toEqual([
      "sequences commute-jeongja.up[1]: stop jeongja-exit3 appears twice",
    ]);
  });

  it("rejects an unknown action or timing", () => {
    expect(errorsFor(catalog(validStop(), seq({ ...BOARD, action: "stop" }, CAMPUS)))).toContain(
      'sequences commute-jeongja.up[0]: action must be "board" or "alight"',
    );
    expect(errorsFor(catalog(validStop(), seq(BOARD, { ...CAMPUS, timing: "approx" })))).toEqual([
      'sequences commute-jeongja.up[1]: timing must be "scheduled" or "estimated"',
    ]);
  });

  it("rejects a run that does not start by boarding, or never lets anyone off", () => {
    expect(errorsFor(catalog(validStop(), seq(CAMPUS, BOARD)))).toEqual([
      "sequences commute-jeongja.up: the first stop must be a boarding stop",
    ]);
    const second = { label: { ko: "다른 정류장" }, action: "board", timing: "scheduled" };
    expect(errorsFor(catalog(validStop(), seq(BOARD, second)))).toEqual([
      "sequences commute-jeongja.up: must have at least one alighting stop",
    ]);
  });

  it("accepts a run that boards at two stops (the 강남·양재 shape)", () => {
    const second: Record<string, unknown> = { ...validStop(), id: "second-stop" };
    const raw = {
      stops: [validStop(), second],
      sequences: seq(BOARD, { stopId: "second-stop", action: "board", timing: "scheduled" }, CAMPUS),
    };
    expect(errorsFor(raw)).toEqual([]);
  });

  it("rejects a note without Korean text", () => {
    expect(errorsFor(catalog(validStop(), seq({ ...BOARD, note: { en: "Board · Jeongja" } }, CAMPUS)))).toEqual([
      "sequences commute-jeongja.up[0]: note has no Korean text",
    ]);
  });

  it("rejects a label or detail without Korean text", () => {
    expect(errorsFor(catalog(validStop(), seq(BOARD, { ...CAMPUS, label: { en: "NSC" } })))).toEqual([
      "sequences commute-jeongja.up[1]: label has no Korean text",
    ]);
    expect(errorsFor(catalog(validStop(), seq(BOARD, { ...CAMPUS, detail: { ko: " " } })))).toEqual([
      "sequences commute-jeongja.up[1]: detail has no Korean text",
    ]);
  });

  describe("walk direction matches how the stop is used", () => {
    const ALIGHT = { stopId: "jeongja-exit3", action: "alight", timing: "estimated" };
    const NSC_BOARD = { label: { ko: "N센터 건너편" }, action: "board", timing: "scheduled" };
    const dropOff = () =>
      withGuide({ places: [exitPlace()], walks: [walk({ from: "stop", to: "exit3", path: [{ ...STOP }, { ...EXIT }] })] });

    it("rejects a walk to the stop where some sequence alights, naming the stop and the sequence", () => {
      const raw = catalog(validStop(), { "commute-jeongja": { up: [BOARD, CAMPUS], down: [NSC_BOARD, ALIGHT] } });
      expect(errorsFor(raw)).toEqual([
        "sequences commute-jeongja.down[1]: stop jeongja-exit3 has a walk to the stop (boarding), but this sequence alights there",
      ]);
    });

    it("rejects a walk from the stop where some sequence boards", () => {
      expect(errorsFor(catalog(dropOff()))).toEqual([
        "sequences commute-jeongja.up[0]: stop jeongja-exit3 has a walk from the stop (alighting), but this sequence boards there",
      ]);
    });

    it("accepts a walk from a drop-off, and a stop used both ways with no walk", () => {
      expect(errorsFor(catalog(dropOff(), seq(NSC_BOARD, ALIGHT)))).toEqual([]);
      const both = withGuide({ places: [exitPlace()] });
      expect(errorsFor(catalog(both, { "commute-jeongja": { up: [BOARD, CAMPUS], down: [NSC_BOARD, ALIGHT] } }))).toEqual([]);
    });
  });
});
