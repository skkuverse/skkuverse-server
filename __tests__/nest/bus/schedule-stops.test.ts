/**
 * The boarding-stop catalog validator: one case per rule in the
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
    exit: { number: 3, coords: { ...EXIT } },
    walkPath: [{ ...EXIT }, { lat: 37.3657, lng: 127.10785 }, { ...STOP }],
  };
}

function catalog(stop: Record<string, unknown> = validStop(), boarding?: unknown) {
  return {
    stops: [stop],
    boarding: boarding ?? {
      "commute-jeongja": [{ routeTypes: ["up"], stopId: "jeongja-exit3", alight: { ko: "N센터 인근" } }],
    },
  };
}

function errorsFor(raw: unknown): string[] {
  return validateStopCatalog(raw, SERVICES);
}

describe("validateStopCatalog", () => {
  it("accepts the empty catalog and a complete stop", () => {
    expect(errorsFor({ stops: [], boarding: {} })).toEqual([]);
    expect(errorsFor(catalog())).toEqual([]);
  });

  it("the committed catalog loaded without errors", () => {
    // The module would have exited (or, under test, served an empty catalog)
    // on any error; the file is checked through the built config elsewhere.
    expect(validateStopCatalog(stopCatalog, new Set(Object.keys(require("../../../src/bus/schedule/service-config").default)))).toEqual([]);
  });

  it("rejects a malformed root", () => {
    expect(errorsFor([])).toEqual(["schedule-stops.json must be { stops: [], boarding: {} }"]);
  });

  it("rejects a duplicate stop id", () => {
    const raw = { stops: [validStop(), validStop()], boarding: {} };
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

  it("rejects an exit without a walking path, and a path without an exit", () => {
    const noPath = validStop();
    delete noPath.walkPath;
    const noExit = validStop();
    delete noExit.exit;
    for (const stop of [noPath, noExit]) {
      expect(errorsFor(catalog(stop))).toEqual(["stop jeongja-exit3: exit and walkPath must be set together"]);
    }
  });

  it("rejects a walking path of one point", () => {
    const stop = { ...validStop(), walkPath: [{ ...EXIT }] };
    expect(errorsFor(catalog(stop))).toEqual(["stop jeongja-exit3: walkPath must have at least two points"]);
  });

  it("rejects a walking path that does not start at the exit", () => {
    const stop = { ...validStop(), walkPath: [{ lat: 37.3659, lng: 127.1077 }, { ...STOP }] };
    expect(errorsFor(catalog(stop))).toEqual(["stop jeongja-exit3: walkPath must start at the exit's coordinates"]);
  });

  it("rejects a walking path that ends elsewhere", () => {
    const stop = { ...validStop(), walkPath: [{ ...EXIT }, { lat: 37.3655, lng: 127.1079 }] };
    expect(errorsFor(catalog(stop))).toEqual(["stop jeongja-exit3: walkPath must end at the stop's coordinates"]);
  });

  it("rejects a walking path longer than 500 m", () => {
    const far = { lat: 37.371, lng: 127.1077 }; // about 560 m north of the exit
    const stop = { ...validStop(), coords: far, walkPath: [{ ...EXIT }, far] };
    expect(errorsFor(catalog(stop))[0]).toMatch(/^stop jeongja-exit3: walkPath is \d+ m, longer than 500 m$/);
  });

  it("rejects a boarding entry naming an unknown stop, naming the service and the id", () => {
    const raw = catalog(validStop(), { "commute-jeongja": [{ routeTypes: ["up"], stopId: "nowhere" }] });
    expect(errorsFor(raw)).toEqual(['boarding commute-jeongja[0]: unknown stop id "nowhere"']);
  });

  it("rejects boarding for an unknown service", () => {
    const raw = catalog(validStop(), { "commute-typo": [{ routeTypes: ["up"], stopId: "jeongja-exit3" }] });
    expect(errorsFor(raw)).toEqual(["boarding commute-typo: unknown service"]);
  });

  it("rejects an empty routeTypes", () => {
    const raw = catalog(validStop(), { "commute-jeongja": [{ routeTypes: [], stopId: "jeongja-exit3" }] });
    expect(errorsFor(raw)).toEqual(["boarding commute-jeongja[0]: routeTypes must be a non-empty list of names"]);
  });

  it("rejects a route type repeated within one service", () => {
    const raw = catalog(validStop(), {
      "commute-jeongja": [
        { routeTypes: ["up"], stopId: "jeongja-exit3" },
        { routeTypes: ["down", "up"], stopId: "jeongja-exit3" },
      ],
    });
    expect(errorsFor(raw)).toEqual(["boarding commute-jeongja[1]: route type up appears in more than one entry"]);
  });

  it("rejects an alight line without Korean text", () => {
    const raw = catalog(validStop(), {
      "commute-jeongja": [{ routeTypes: ["up"], stopId: "jeongja-exit3", alight: { en: "N Center" } }],
    });
    expect(errorsFor(raw)).toEqual(["boarding commute-jeongja[0]: alight has no Korean text"]);
  });
});
