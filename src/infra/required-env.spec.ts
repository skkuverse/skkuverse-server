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
import { envRole, roleErrors, ROLES, validateEnv } from "./required-env";

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
    const development = { ...process.env, NODE_ENV: "development" };

    // Act & Assert
    expect(() => validateEnv({ ...development, ROLE: "poler" })).toThrow(
      /Invalid ROLE[\s\S]*ROLE must be one of api \| poller \| combined \(got "poler"\)/,
    );
    expect(() => validateEnv({ ...development, ROLE: "api" })).not.toThrow();
  });
});
