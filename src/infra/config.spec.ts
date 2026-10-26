/**
 * Loading src/infra/config.ts under NODE_ENV=test with a malformed required
 * value. A test runs without most keys (jest.setup.ts gives dummies), so a
 * missing value only logs there; but a value present in the wrong shape is a
 * test that set it on purpose, and it must fail the load as the polling roles'
 * boot does, rather than log and carry on with a key TOPIS would reject.
 * `ROLE=api` does not require the TOPIS key, so a malformed one loads there.
 *
 * Each case requires a fresh copy of the module with jest.isolateModules,
 * under an env it restores in a `finally`.
 */
import { OVERLAY_ENTRY } from "../perimeter/perimeter-overlay.rules";

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), fatal: jest.fn() };
jest.mock("./logger", () => mockLogger);

const TOUCHED = ["NODE_ENV", "ROLE", "SEOUL_BUS_SERVICE_KEY", "PERIMETER_MODE", "HOST", "PERIMETER_OVERLAY_SHA"] as const;

/** Requires a fresh config.ts with `env` over the test env, returns it, and restores the env after. */
function loadConfigWith(env: Partial<Record<(typeof TOUCHED)[number], string | undefined>>): typeof import("./config") {
  const saved = new Map(TOUCHED.map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    let loaded: typeof import("./config") | undefined;
    jest.isolateModules(() => {
      loaded = require("./config");
    });
    return loaded!;
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("loading config under NODE_ENV=test", () => {
  it.each(["poller", "combined"])("throws on a malformed SEOUL_BUS_SERVICE_KEY in ROLE=%s, naming it and how to fix it", (role) => {
    // Act & Assert
    expect(() => loadConfigWith({ NODE_ENV: "test", ROLE: role, SEOUL_BUS_SERVICE_KEY: "ABC+DEF=" })).toThrow(
      /Malformed required config[\s\S]*api\.seoulBusServiceKey \(env: SEOUL_BUS_SERVICE_KEY\): must be URL-encoded.*encodeURIComponent/,
    );
    expect(mockLogger.fatal).toHaveBeenCalledWith(expect.objectContaining({ event: "config.malformed_required" }), expect.any(String));
  });

  it("loads with a malformed key in ROLE=api, which only the pollers read", () => {
    // Act & Assert
    expect(() => loadConfigWith({ NODE_ENV: "test", ROLE: "api", SEOUL_BUS_SERVICE_KEY: "ABC+DEF=" })).not.toThrow();
  });

  it("loads with the key missing in a polling role, as every test without one does", () => {
    // Act & Assert
    expect(() => loadConfigWith({ NODE_ENV: "test", ROLE: "poller", SEOUL_BUS_SERVICE_KEY: undefined })).not.toThrow();
  });

  it("loads with the URL-encoded test key in a polling role", () => {
    // Act & Assert
    expect(() => loadConfigWith({ NODE_ENV: "test", ROLE: "poller", SEOUL_BUS_SERVICE_KEY: "test-seoul-bus-key" })).not.toThrow();
  });
});

describe("loading config with an invalid perimeter mode or host", () => {
  it("throws under NODE_ENV=test without PERIMETER_MODE, naming it", () => {
    // Act & Assert
    expect(() => loadConfigWith({ NODE_ENV: "test", PERIMETER_MODE: undefined })).toThrow(/Invalid perimeter[\s\S]*PERIMETER_MODE is required/);
    expect(mockLogger.fatal).toHaveBeenCalledWith(expect.objectContaining({ event: "config.invalid_perimeter" }), expect.any(String));
  });

  // WHY: config.ts runs before the error reporter starts, so overlay mode only resolves the entry here.
  it("resolves the overlay entry in overlay mode without loading it", () => {
    // Arrange
    const loaded = jest.fn();
    // WHY: by the absolute entry path, never a relative specifier: Jest keys a mock by the resolved path, which a
    // checkout without the overlay maps to the stand-in entry (jest.config.js).
    jest.doMock(OVERLAY_ENTRY, () => {
      loaded();
      return {};
    });

    try {
      // Act & Assert
      expect(() => loadConfigWith({ NODE_ENV: "test", PERIMETER_MODE: "overlay" })).not.toThrow();
      expect(loaded).not.toHaveBeenCalled();
    } finally {
      jest.dontMock(OVERLAY_ENTRY);
    }
  });

  // WHY: the image bakes the overlay's companion commit into PERIMETER_OVERLAY_SHA (Dockerfile); a build without one
  // reads `none`, so the boot line and the Sentry tag never show an empty identity.
  it.each([
    ["unset", undefined, "none"],
    ["empty", "", "none"],
    ["a commit", "0123456789abcdef0123456789abcdef01234567", "0123456789abcdef0123456789abcdef01234567"],
  ])("reports the overlay build as the image names it, %s", (_case, value, expected) => {
    // Act
    const loaded = loadConfigWith({ NODE_ENV: "test", PERIMETER_OVERLAY_SHA: value });

    // Assert
    expect(loaded.perimeter.overlayBuild).toBe(expected);
  });

  it("throws in a listening role without HOST, and loads the poller without one", () => {
    // Act & Assert
    expect(() => loadConfigWith({ NODE_ENV: "test", ROLE: "api", HOST: undefined })).toThrow(/HOST is required where the server listens/);
    expect(() => loadConfigWith({ NODE_ENV: "test", ROLE: "poller", HOST: undefined })).not.toThrow();
  });
});
