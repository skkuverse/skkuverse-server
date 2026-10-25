/**
 * The overlay checks of ADR 0023, D3 and D4: config.ts only resolves the entry, and validateEnv() loads it and
 * refuses an entry built against other ports, one missing a class that extends a port, or settings sections (every
 * set PERIMETER_SETTINGS… variable, perimeterSettingsOf) the entry's own check refuses, so a bad image stops at the pre-deploy dry-load instead of at the first request. A synthetic
 * entry, the LocalDev classes with a scripted settings check, stands in for the overlay wherever the case is about
 * the loader, so only the cases about the entry this build carries read it.
 */
import { LOCAL_DEV_CLASSES } from "./local-dev/perimeter-classes";
import { loadOverlayEntry, OVERLAY_ENTRY, overlayEntryErrors, overlayResolveErrors, perimeterOverlayErrors, perimeterSettingsOf } from "./perimeter-overlay.rules";
import { OriginTrust, PERIMETER_PORTS_VERSION, type PerimeterOverlay } from "./perimeter.ports";

const OVERLAY = { NODE_ENV: "production", PERIMETER_MODE: "overlay", HOST: "0.0.0.0" };

const entry = (overrides: Partial<Record<keyof PerimeterOverlay, unknown>> = {}): Record<string, unknown> => ({
  portsVersion: PERIMETER_PORTS_VERSION,
  classes: LOCAL_DEV_CLASSES,
  settingsErrors: () => [],
  ...overrides,
});

// WHY: one object for every case: Jest keeps the first export a mock factory returned, so each case refills it.
const mockedEntry: Record<string, unknown> = {};

/** Runs `act` with OVERLAY_ENTRY resolving to `overlay`, whether or not this checkout carries an entry. */
function withEntry<T>(overlay: Record<string, unknown>, act: () => T): T {
  for (const key of Object.keys(mockedEntry)) delete mockedEntry[key];
  Object.assign(mockedEntry, overlay);
  // WHY: virtual only when no entry resolves: Jest keys a mock of a file that exists by its resolved path.
  jest.doMock(OVERLAY_ENTRY, () => mockedEntry, { virtual: overlayResolveErrors().length > 0 });
  try {
    return act();
  } finally {
    jest.dontMock(OVERLAY_ENTRY);
  }
}

describe("overlayResolveErrors", () => {
  it("accepts the entry this build carries, which resolves", () => {
    // Act & Assert
    expect(overlayResolveErrors()).toEqual([]);
  });

  it("refuses an entry that does not resolve, naming the mode", () => {
    // Arrange
    let errors: string[] = [];
    jest.isolateModules(() => {
      jest.doMock("node:path", () => {
        const actual = jest.requireActual<typeof import("node:path")>("node:path");
        return { ...actual, join: (...parts: string[]) => actual.join(...parts.map((part) => (part === "perimeter.overlay" ? "perimeter.absent" : part))) };
      });
      const rules = require("./perimeter-overlay.rules") as typeof import("./perimeter-overlay.rules");

      // Act
      errors = rules.overlayResolveErrors();
    });

    // Assert
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/PERIMETER_MODE=overlay needs its implementation entry, which does not resolve \(.*perimeter\.absent\)/);
  });
});

describe("overlayEntryErrors", () => {
  it("accepts an entry built against these ports, with a class extending every port", () => {
    // Act & Assert
    expect(overlayEntryErrors(entry(), {})).toEqual([]);
  });

  it.each([
    ["no object", null, /entry exports no object/],
    ["another ports version", entry({ portsVersion: PERIMETER_PORTS_VERSION + 1 }), new RegExp(`built against ports version ${PERIMETER_PORTS_VERSION + 1}, this build is ${PERIMETER_PORTS_VERSION}`)],
    ["no classes record", entry({ classes: undefined }), /entry exports no classes/],
    ["no settings check", entry({ settingsErrors: "none" }), /entry exports no settingsErrors function/],
  ])("refuses %s", (_label, value, message) => {
    // Act
    const errors = overlayEntryErrors(value, {});

    // Assert
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(message);
  });

  it("names each port whose class is missing or does not extend the port", () => {
    // Arrange
    const withoutOriginTrust: Record<string, unknown> = { ...LOCAL_DEV_CLASSES };
    delete withoutOriginTrust.originTrust;
    class Unrelated {}

    // Act
    const missing = overlayEntryErrors(entry({ classes: withoutOriginTrust }), {});
    const unrelated = overlayEntryErrors(entry({ classes: { ...LOCAL_DEV_CLASSES, outboundPolicy: Unrelated } }), {});

    // Assert
    expect(missing).toEqual(["ORIGIN_TRUST: the entry has no class that extends the port"]);
    expect(unrelated).toEqual(["OUTBOUND_POLICY: the entry has no class that extends the port"]);
    expect(LOCAL_DEV_CLASSES.originTrust.prototype instanceof OriginTrust).toBe(true);
  });

  it("passes the settings sections to the entry's own check and reports what it refuses, as it names them", () => {
    // Arrange
    const settingsErrors = jest.fn((_settings: Record<string, string>) => ["PERIMETER_SETTINGS_QUOTAS: miniAppPush: is required"]);
    const sections = { PERIMETER_SETTINGS: "e30", PERIMETER_SETTINGS_QUOTAS: "e31" };

    // Act
    const errors = overlayEntryErrors(entry({ settingsErrors }), sections);

    // Assert
    expect(settingsErrors).toHaveBeenCalledWith(sections);
    expect(errors).toEqual(["PERIMETER_SETTINGS_QUOTAS: miniAppPush: is required"]);
  });

  it("refuses a check that returns no list", () => {
    // Act & Assert
    expect(overlayEntryErrors(entry({ settingsErrors: () => "fine" }), {})).toEqual(["the entry's settingsErrors returned no list"]);
  });
});

describe("perimeterSettingsOf", () => {
  it("takes every set PERIMETER_SETTINGS section variable, by name, and nothing else", () => {
    // Arrange
    const env = {
      PERIMETER_SETTINGS: "a",
      PERIMETER_SETTINGS_QUOTAS: "b",
      PERIMETER_SETTINGS_SENDER_LIMITS: "c",
      PERIMETER_SETTINGS_EMPTY: "",
      PERIMETER_SETTINGSX: "d",
      PERIMETER_SETTINGS_: "e",
      PERIMETER_SETTINGS__QUOTAS: "f",
      PERIMETER_SETTINGS_quotas: "g",
      PERIMETER_SETTINGS_2: "h",
      PERIMETER_QUOTAS: "i",
      X_PERIMETER_SETTINGS: "j",
    };

    // Act & Assert
    expect(perimeterSettingsOf(env)).toEqual({ PERIMETER_SETTINGS: "a", PERIMETER_SETTINGS_QUOTAS: "b", PERIMETER_SETTINGS_SENDER_LIMITS: "c" });
  });
});

describe("perimeterOverlayErrors", () => {
  it("checks nothing outside overlay mode", () => {
    // Act & Assert
    expect(perimeterOverlayErrors({ NODE_ENV: "development", PERIMETER_MODE: "local-dev", HOST: "127.0.0.1" })).toEqual([]);
    expect(perimeterOverlayErrors({ NODE_ENV: "test", PERIMETER_MODE: "test", HOST: "127.0.0.1" })).toEqual([]);
  });

  it("loads and accepts the entry this build carries, with the settings it reads", () => {
    // Act & Assert
    expect(perimeterOverlayErrors({ ...OVERLAY, PERIMETER_SETTINGS: process.env.PERIMETER_SETTINGS, PERIMETER_SETTINGS_QUOTAS: process.env.PERIMETER_SETTINGS_QUOTAS })).toEqual([]);
  });

  it("hands the entry's check the sections the environment sets, and reports what it refuses", () => {
    // Arrange
    const settingsErrors = jest.fn((settings: Record<string, string>) => (settings.PERIMETER_SETTINGS_QUOTAS === undefined ? ["PERIMETER_SETTINGS_QUOTAS: is required in overlay mode"] : []));

    // Act
    const errors = withEntry(entry({ settingsErrors }), () => perimeterOverlayErrors({ ...OVERLAY, PERIMETER_SETTINGS: "e30", PERIMETER_QUOTAS: "e31" }));

    // Assert
    expect(settingsErrors).toHaveBeenCalledWith({ PERIMETER_SETTINGS: "e30" });
    expect(errors).toEqual(["PERIMETER_SETTINGS_QUOTAS: is required in overlay mode"]);
  });
});

describe("loadOverlayEntry", () => {
  it("hands back the entry's classes, one per port", () => {
    // Act
    const overlay = withEntry(entry(), () => loadOverlayEntry());

    // Assert
    expect(overlay.portsVersion).toBe(PERIMETER_PORTS_VERSION);
    expect(overlay.classes).toBe(LOCAL_DEV_CLASSES);
  });

  it("throws naming what is wrong with the entry", () => {
    // Act & Assert
    expect(() => withEntry(entry({ portsVersion: 0 }), () => loadOverlayEntry())).toThrow(/Invalid perimeter overlay:\n {2}the overlay entry is built against ports version 0/);
  });
});
