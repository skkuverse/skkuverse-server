/**
 * describeMissingRequired() resolves each required value the way
 * src/infra/config.ts does. The api.hsscNew entry is the only one resolved
 * through apiUrl() (DEV preferred, PROD as fallback) rather than read straight
 * off process.env: reading API_HSSC_NEW_PROD directly would crash the Nest
 * validator in Development mode when a dev sets only API_HSSC_NEW_DEV, a
 * config src/infra/config.ts accepts. AI_API_URL has no default, so it is
 * reported when unset.
 *
 * Each scenario sets env, then loads the module fresh with
 * jest.isolateModules().
 */
import { envRole, isPollingRole, listMalformedRequired, listMissingRequired, requiredValues, roleErrors, ROLES, validateEnv } from "./required-env";

const HSSC_KEYS = ["API_HSSC_NEW_PROD", "API_HSSC_NEW_DEV"] as const;

function withEnv(
  env: Record<string, string | undefined>,
  fn: (findMissing: () => string[]) => void,
): void {
  const saved: Record<string, string | undefined> = {};
  const keys = [
    "NODE_ENV",
    "USE_PROD_API",
    ...HSSC_KEYS,
  ];
  for (const k of keys) saved[k] = process.env[k];
  try {
    for (const k of keys) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    jest.isolateModules(() => {
      const mod = require("./required-env");
      fn(mod.describeMissingRequired);
    });
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

function hsscMissing(missing: string[]): boolean {
  return missing.some((m) => m.includes("api.hsscNew"));
}

describe("describeMissingRequired api.hsscNew matches src/infra/config.ts apiUrl()", () => {
  // Baseline: jest.setup.ts defines all other required vars, so api.hsscNew is
  // the only entry that flips based on the HSSC env we control here.

  it("Development with only API_HSSC_NEW_DEV set → NOT missing (src/infra/config.ts accepts it)", () => {
    // Act & Assert
    withEnv(
      {
        NODE_ENV: "development",
        USE_PROD_API: undefined,
        API_HSSC_NEW_PROD: undefined,
        API_HSSC_NEW_DEV: "http://hssc-dev",
      },
      (findMissing) => {
        expect(hsscMissing(findMissing())).toBe(false);
      },
    );
  });

  it("Development with neither key set → missing", () => {
    // Act & Assert
    withEnv(
      {
        NODE_ENV: "development",
        USE_PROD_API: undefined,
        API_HSSC_NEW_PROD: undefined,
        API_HSSC_NEW_DEV: undefined,
      },
      (findMissing) => {
        expect(hsscMissing(findMissing())).toBe(true);
      },
    );
  });

  it("Staging-check (USE_PROD_API=true) with only API_HSSC_NEW_DEV → missing (prod key required)", () => {
    // Act & Assert
    withEnv(
      {
        NODE_ENV: "development",
        USE_PROD_API: "true",
        API_HSSC_NEW_PROD: undefined,
        API_HSSC_NEW_DEV: "http://hssc-dev",
      },
      (findMissing) => {
        expect(hsscMissing(findMissing())).toBe(true);
      },
    );
  });

  it("Production with only API_HSSC_NEW_PROD set → NOT missing", () => {
    // Act & Assert
    withEnv(
      {
        NODE_ENV: "production",
        USE_PROD_API: undefined, // production forces USE_PROD_API
        API_HSSC_NEW_PROD: "http://hssc-prod",
        API_HSSC_NEW_DEV: undefined,
      },
      (findMissing) => {
        expect(hsscMissing(findMissing())).toBe(false);
      },
    );
  });
});

describe("describeMissingRequired AI_API_URL", () => {
  // GET /notices/overview cannot work without it, and there is no default.
  it("reports AI_API_URL as missing when it is unset", () => {
    // Arrange
    const saved = process.env.AI_API_URL;
    delete process.env.AI_API_URL;

    // Act & Assert
    try {
      jest.isolateModules(() => {
        const mod = require("./required-env");
        expect(mod.describeMissingRequired()).toContain(
          "  notices.overview.aiApiUrl (env: AI_API_URL)",
        );
      });
    } finally {
      if (saved === undefined) delete process.env.AI_API_URL;
      else process.env.AI_API_URL = saved;
    }
  });
});

describe("envRole", () => {
  it.each([
    [undefined, "combined"],
    ["", "combined"],
    ["api", "api"],
    ["poller", "poller"],
    ["combined", "combined"],
  ])("reads ROLE=%p as %s", (raw, role) => {
    // Act & Assert
    expect(envRole({ ROLE: raw })).toBe(role);
  });

  it.each(["poler", "API", "web"])("throws on ROLE=%s instead of booting as combined", (raw) => {
    // Act & Assert
    expect(() => envRole({ ROLE: raw })).toThrow(`ROLE must be one of api | poller | combined (got "${raw}")`);
  });
});

describe("isPollingRole", () => {
  it.each([
    ["api", false],
    ["poller", true],
    ["combined", true],
  ] as const)("ROLE=%s runs pollers: %s", (role, polls) => {
    // Act & Assert
    expect(isPollingRole(role)).toBe(polls);
  });
});

describe("roleErrors", () => {
  it("reports an unknown ROLE and passes every known one and unset", () => {
    // Act & Assert
    expect(roleErrors({ ROLE: "poler" })).toEqual([
      'ROLE must be one of api | poller | combined (got "poler")',
    ]);
    for (const raw of [undefined, "", ...ROLES]) expect(roleErrors({ ROLE: raw })).toEqual([]);
  });
});

describe("validateEnv refuses an unknown ROLE", () => {
  it("throws on ROLE=poler in development, and passes ROLE=api", () => {
    // Arrange
    const development = { ...process.env, NODE_ENV: "development", PERIMETER_MODE: "local-dev" };

    // Act & Assert
    expect(() => validateEnv({ ...development, ROLE: "poler" })).toThrow(
      /Invalid ROLE[\s\S]*ROLE must be one of api \| poller \| combined \(got "poler"\)/,
    );
    expect(() => validateEnv({ ...development, ROLE: "api" })).not.toThrow();
  });
});

describe("describeMissingRequired DATA_GO_KR_SERVICE_KEY", () => {
  // The GBIS seat poller cannot call getBusLocationListv2 without it, and there is no default.
  it("reports DATA_GO_KR_SERVICE_KEY as missing when it is unset", () => {
    // Arrange
    const saved = process.env.DATA_GO_KR_SERVICE_KEY;
    delete process.env.DATA_GO_KR_SERVICE_KEY;

    // Act & Assert
    try {
      jest.isolateModules(() => {
        const mod = require("./required-env");
        expect(mod.describeMissingRequired()).toContain("  gbis.serviceKey (env: DATA_GO_KR_SERVICE_KEY)");
      });
    } finally {
      if (saved === undefined) delete process.env.DATA_GO_KR_SERVICE_KEY;
      else process.env.DATA_GO_KR_SERVICE_KEY = saved;
    }
  });
});

describe("requiredValues scopes each value to the roles that read it", () => {
  it("scopes the pollers' upstream keys to poller, what only serving reads to api, and the rest to all", () => {
    // Act
    const scopeOf = Object.fromEntries(requiredValues({ NODE_ENV: "production" }).map((v) => [v.env, v.scope]));

    // Assert
    expect(scopeOf).toEqual({
      MONGO_URL: "all",
      MONGO_DB_NAME_BUS_CAMPUS: "all",
      API_HSSC_NEW_PROD: "poller",
      SEOUL_BUS_SERVICE_KEY: "poller",
      NAVER_MAP_STYLE_ID: "api",
      MONGO_BUILDING_DB_NAME: "all",
      MONGO_NOTICES_DB_NAME: "all",
      MONGO_EVENTMAP_DB_NAME: "all",
      MONGO_MINIAPPS_DB_NAME: "all",
      MONGO_MEALS_DB_NAME: "all",
      MONGO_CONTENT_DB_NAME: "all",
      NOTICES_SERVICE_START_DATE: "api",
      FCM_FUNCTION_URL: "all",
      FCM_API_KEY: "all",
      INTERNAL_DISPATCH_TOKEN: "api",
      MINIAPP_PUSH_TOKEN: "api",
      AI_API_URL: "api",
      NAVER_API_KEY_ID: "poller",
      NAVER_API_KEY: "poller",
      TMAP_APP_KEY: "poller",
      SEOUL_SUBWAY_API_KEY: "poller",
      SHUTTLE_TOKEN: "poller",
      DATA_GO_KR_SERVICE_KEY: "poller",
      SENTRY_DSN: "all",
    });
  });
});

describe("listMissingRequired checks only the values the role needs", () => {
  const missingIn = (role: string | undefined, without: string): string[] => {
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "development", PERIMETER_MODE: "local-dev", ROLE: role };
    delete env[without];
    return listMissingRequired(env).map((v) => v.env);
  };

  it.each([
    ["poller", ["TMAP_APP_KEY"]],
    ["combined", ["TMAP_APP_KEY"]],
    [undefined, ["TMAP_APP_KEY"]],
    ["api", []],
  ])("without TMAP_APP_KEY, ROLE=%s misses %j", (role, missing) => {
    // Act & Assert
    expect(missingIn(role, "TMAP_APP_KEY")).toEqual(missing);
  });

  it.each([
    ["api", ["AI_API_URL"]],
    ["combined", ["AI_API_URL"]],
    ["poller", []],
  ])("without AI_API_URL, ROLE=%s misses %j", (role, missing) => {
    // Act & Assert
    expect(missingIn(role, "AI_API_URL")).toEqual(missing);
  });

  it.each([
    ["api", ["MINIAPP_PUSH_TOKEN"]],
    ["combined", ["MINIAPP_PUSH_TOKEN"]],
    ["poller", []],
  ])("without MINIAPP_PUSH_TOKEN, ROLE=%s misses %j", (role, missing) => {
    // Act & Assert
    expect(missingIn(role, "MINIAPP_PUSH_TOKEN")).toEqual(missing);
  });

  it("refuses a poller boot without SEOUL_BUS_SERVICE_KEY, naming it", () => {
    // Arrange
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "development", ROLE: "poller" };
    delete env.SEOUL_BUS_SERVICE_KEY;

    // Act & Assert
    expect(() => validateEnv(env)).toThrow(/api\.seoulBusServiceKey \(env: SEOUL_BUS_SERVICE_KEY\)/);
  });

  it("checks every value under an unknown ROLE, which validation refuses on its own", () => {
    // Act & Assert
    expect(missingIn("poler", "AI_API_URL")).toEqual(["AI_API_URL"]);
    expect(missingIn("poler", "TMAP_APP_KEY")).toEqual(["TMAP_APP_KEY"]);
  });
});

describe("requiredValues MONGO_CONTENT_DB_NAME", () => {
  // The content database holds the datasets every replica serves and the poller may later write (ADR 0013).
  it.each([
    ["production", "skku_content"],
    ["development", "skku_content_dev"],
    ["test", "skku_content_test"],
  ])("names the content database in %s as %s, required in every role", (nodeEnv, dbName) => {
    // Act
    const content = requiredValues({ NODE_ENV: nodeEnv, MONGO_CONTENT_DB_NAME: "skku_content" }).find((v) => v.env === "MONGO_CONTENT_DB_NAME");

    // Assert
    expect(content).toEqual({ name: "content.dbName", env: "MONGO_CONTENT_DB_NAME", value: dbName, scope: "all" });
  });

  it.each(["api", "poller", "combined"])("refuses a ROLE=%s boot without it, naming it", (role) => {
    // Arrange
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "development", PERIMETER_MODE: "local-dev", ROLE: role };
    delete env.MONGO_CONTENT_DB_NAME;

    // Act & Assert
    expect(() => validateEnv(env)).toThrow(/content\.dbName \(env: MONGO_CONTENT_DB_NAME\)/);
  });
});

describe("listMalformedRequired SEOUL_BUS_SERVICE_KEY", () => {
  // A raw base64 key splits the TOPIS query string, and TOPIS rejects it as if it were down.
  const FIXED_KEY = "FAKEseoulBusServiceKeyForTestsOnlyNotARealKey0000%2BFAKE%2Fseoul%2Bbus%2Ftest0key%3D%3D";
  const envWithKey = (role: string | undefined, key: string | undefined): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "development", PERIMETER_MODE: "local-dev", ROLE: role };
    if (key === undefined) delete env.SEOUL_BUS_SERVICE_KEY;
    else env.SEOUL_BUS_SERVICE_KEY = key;
    return env;
  };
  const malformedIn = (role: string | undefined, key: string | undefined): string[] =>
    listMalformedRequired(envWithKey(role, key)).map((v) => v.env);

  it.each([
    ["poller", ["SEOUL_BUS_SERVICE_KEY"]],
    ["combined", ["SEOUL_BUS_SERVICE_KEY"]],
    [undefined, ["SEOUL_BUS_SERVICE_KEY"]],
    ["api", []],
  ])("with a raw base64 key, ROLE=%s reports %j", (role, malformed) => {
    // Act & Assert
    expect(malformedIn(role, "ABC+DEF/GH==")).toEqual(malformed);
  });

  it.each(["ABC+DEF=", "ABC/DEF", "ABC=", "ABC&DEF", "ABC DEF"])("reports %j, which is not URL-encoded", (key) => {
    // Act & Assert
    expect(malformedIn("poller", key)).toEqual(["SEOUL_BUS_SERVICE_KEY"]);
  });

  it.each([FIXED_KEY, "test-seoul-bus-key"])("accepts the URL-encoded key %j", (key) => {
    // Act & Assert
    expect(malformedIn("poller", key)).toEqual([]);
  });

  it.each([undefined, ""])("reports a key of %j as missing, not malformed", (key) => {
    // Act
    const missing = listMissingRequired(envWithKey("poller", key)).map((v) => v.env);

    // Assert
    expect(missing).toEqual(["SEOUL_BUS_SERVICE_KEY"]);
    expect(malformedIn("poller", key)).toEqual([]);
  });

  it.each(["poller", "combined"])("refuses a ROLE=%s boot with a malformed key, naming it and how to fix it", (role) => {
    // Act & Assert
    expect(() => validateEnv(envWithKey(role, "ABC+DEF="))).toThrow(
      /api\.seoulBusServiceKey \(env: SEOUL_BUS_SERVICE_KEY\): must be URL-encoded.*encodeURIComponent/,
    );
  });

  it("lets a ROLE=api boot with a malformed key, which only the pollers read", () => {
    // Act & Assert
    expect(() => validateEnv(envWithKey("api", "ABC+DEF="))).not.toThrow();
  });
});

describe("validateEnv refuses an invalid perimeter mode or host", () => {
  it("throws in development without PERIMETER_MODE, and with local-dev on every interface", () => {
    // Arrange
    const development = { ...process.env, NODE_ENV: "development", PERIMETER_MODE: "local-dev", HOST: "127.0.0.1" };

    // Act & Assert
    expect(() => validateEnv({ ...development, PERIMETER_MODE: undefined })).toThrow(/Invalid perimeter[\s\S]*PERIMETER_MODE is required/);
    expect(() => validateEnv({ ...development, HOST: "0.0.0.0" })).toThrow(/Invalid perimeter[\s\S]*local-dev needs a loopback HOST/);
    expect(() => validateEnv(development)).not.toThrow();
  });

  it("throws under NODE_ENV=test too, where missing values pass", () => {
    // Arrange
    const test = { ...process.env, NODE_ENV: "test", PERIMETER_MODE: "test", HOST: "127.0.0.1" };

    // Act & Assert
    expect(() => validateEnv({ ...test, PERIMETER_MODE: "staging" })).toThrow(/Invalid perimeter[\s\S]*PERIMETER_MODE must be one of/);
    expect(() => validateEnv({ ...test, MONGO_URL: undefined })).not.toThrow();
  });
});

describe("validateEnv loads the overlay entry in overlay mode", () => {
  const OVERLAY_ENTRY_MODULE = "../perimeter/current/perimeter.overlay";
  const overlayTest = { ...process.env, NODE_ENV: "test", PERIMETER_MODE: "overlay", HOST: "127.0.0.1" };

  // WHY: one object for every case: Jest keeps the first export a mock factory returned, so each case refills it.
  const mockedEntry: Record<string, unknown> = {};

  /** validateEnv from a fresh module registry whose overlay entry is the real one with `overrides`. */
  function validateWithEntry(overrides: Record<string, unknown>, env: NodeJS.ProcessEnv): void {
    let validate: typeof validateEnv | undefined;
    for (const key of Object.keys(mockedEntry)) delete mockedEntry[key];
    jest.isolateModules(() => {
      jest.doMock(OVERLAY_ENTRY_MODULE, () => mockedEntry);
      // WHY: the real entry from the same registry, so its classes extend the ports validateEnv checks against.
      Object.assign(mockedEntry, jest.requireActual(OVERLAY_ENTRY_MODULE), overrides);
      validate = (require("./required-env") as typeof import("./required-env")).validateEnv;
    });
    try {
      validate!(env);
    } finally {
      jest.dontMock(OVERLAY_ENTRY_MODULE);
    }
  }

  it("accepts the entry this build carries, under NODE_ENV=test too", () => {
    // Act & Assert
    expect(() => validateEnv(overlayTest)).not.toThrow();
  });

  it("refuses an entry built against other ports, before the early return for a test", () => {
    // Act & Assert
    expect(() => validateWithEntry({ portsVersion: 0 }, overlayTest)).toThrow(/Invalid perimeter[\s\S]*built against ports version 0/);
  });

  it("refuses settings the entry's own check refuses, naming PERIMETER_SETTINGS", () => {
    // Arrange
    const settingsErrors = (settings: string | undefined) => (settings === "bad" ? ["not base64url JSON"] : []);

    // Act & Assert
    expect(() => validateWithEntry({ settingsErrors }, { ...overlayTest, PERIMETER_SETTINGS: "bad" })).toThrow(
      /Invalid perimeter[\s\S]*PERIMETER_SETTINGS: not base64url JSON/,
    );
  });
});
