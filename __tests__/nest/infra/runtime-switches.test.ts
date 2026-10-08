/**
 * PUSH_DELIVERY / RATE_LIMIT / BUILDING_SYNC (src/infra/runtime-switches.ts).
 *
 * Two halves. The resolver table pins what each mode defaults to and which
 * combinations refuse to boot. The file checks pin where the switches may and
 * may not be set: production's compose file and Doppler key lists never carry
 * one (production must run on the defaults), and local verify — which runs the
 * production image on a laptop holding the real Cloud Function URL — always
 * suppresses push and the building crawl.
 */
import fs from "fs";
import path from "path";
import {
  RUNTIME_SWITCH_NAMES,
  resolveRuntimeSwitches,
  runtimeMode,
} from "../../../src/infra/runtime-switches";

describe("runtimeMode", () => {
  it.each([
    ["production", "production"],
    ["test", "test"],
    ["development", "development"],
    [undefined, "development"],
    ["staging", "development"],
  ] as const)("NODE_ENV=%s → %s", (nodeEnv, mode) => {
    expect(runtimeMode(nodeEnv)).toBe(mode);
  });
});

describe("resolveRuntimeSwitches defaults", () => {
  it("production keeps every side effect and cache on", () => {
    expect(resolveRuntimeSwitches({}, "production")).toEqual({
      switches: {
        pushDelivery: "live",
        rateLimitEnabled: true,
        buildingSyncEnabled: true,
        cacheEnabled: true,
      },
      errors: [],
    });
  });

  it("development turns every outbound side effect, the limiter and the caches off", () => {
    expect(resolveRuntimeSwitches({}, "development")).toEqual({
      switches: {
        pushDelivery: "suppressed",
        rateLimitEnabled: false,
        buildingSyncEnabled: false,
        cacheEnabled: false,
      },
      errors: [],
    });
  });

  it("test keeps production's defaults (fetch is mocked, limiter tests expect 429)", () => {
    expect(resolveRuntimeSwitches({}, "test").switches).toEqual(
      resolveRuntimeSwitches({}, "production").switches,
    );
  });

  it("treats an empty value as unset", () => {
    const { switches, errors } = resolveRuntimeSwitches(
      { PUSH_DELIVERY: "", RATE_LIMIT: "", BUILDING_SYNC: "" },
      "development",
    );
    expect(errors).toEqual([]);
    expect(switches.pushDelivery).toBe("suppressed");
  });
});

describe("resolveRuntimeSwitches overrides", () => {
  it("development may turn the limiter, the building sync and the caches on", () => {
    const { switches, errors } = resolveRuntimeSwitches(
      { RATE_LIMIT: "on", BUILDING_SYNC: "on", CACHE: "on" },
      "development",
    );
    expect(errors).toEqual([]);
    expect(switches.rateLimitEnabled).toBe(true);
    expect(switches.buildingSyncEnabled).toBe(true);
    expect(switches.cacheEnabled).toBe(true);
  });

  it("refuses PUSH_DELIVERY=live in development, and stays suppressed", () => {
    const { switches, errors } = resolveRuntimeSwitches({ PUSH_DELIVERY: "live" }, "development");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/PUSH_DELIVERY=live is refused/);
    expect(switches.pushDelivery).toBe("suppressed");
  });

  it("production may suppress push and stop the building sync (what local verify sets)", () => {
    const { switches, errors } = resolveRuntimeSwitches(
      { PUSH_DELIVERY: "suppressed", BUILDING_SYNC: "off" },
      "production",
    );
    expect(errors).toEqual([]);
    expect(switches.pushDelivery).toBe("suppressed");
    expect(switches.buildingSyncEnabled).toBe(false);
  });

  it("refuses RATE_LIMIT=off in production, and keeps the limiter on", () => {
    const { switches, errors } = resolveRuntimeSwitches({ RATE_LIMIT: "off" }, "production");
    expect(errors).toEqual(["RATE_LIMIT=off is refused in production"]);
    expect(switches.rateLimitEnabled).toBe(true);
  });

  it("refuses CACHE=off in production, and keeps the caches on", () => {
    const { switches, errors } = resolveRuntimeSwitches({ CACHE: "off" }, "production");
    expect(errors).toEqual(["CACHE=off is refused in production"]);
    expect(switches.cacheEnabled).toBe(true);
  });

  it.each([
    ["PUSH_DELIVERY", "dry-run"],
    ["RATE_LIMIT", "true"],
    ["BUILDING_SYNC", "OFF"],
    ["CACHE", "no-store"],
  ])("reports %s=%s instead of coercing it", (name, value) => {
    for (const mode of ["production", "development", "test"] as const) {
      const { errors } = resolveRuntimeSwitches({ [name]: value }, mode);
      expect(errors).toEqual([expect.stringContaining(`${name} must be one of`)]);
    }
  });
});

describe("validateEnv refuses an invalid switch", () => {
  const touched = ["NODE_ENV", "SENTRY_DSN", ...RUNTIME_SWITCH_NAMES];

  /** validateEnv() under exactly `env` (NODE_ENV is read at module load). */
  function validateWith(env: Record<string, string>): () => void {
    return () => {
      const saved = new Map(touched.map((k) => [k, process.env[k]]));
      try {
        for (const k of touched) delete process.env[k];
        Object.assign(process.env, env);
        jest.isolateModules(() => {
          require("../../../src/config/env.validation").validateEnv();
        });
      } finally {
        for (const [k, v] of saved) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      }
    };
  }

  it("throws on PUSH_DELIVERY=live in development", () => {
    expect(validateWith({ NODE_ENV: "development", PUSH_DELIVERY: "live" })).toThrow(
      /Invalid runtime switch[\s\S]*PUSH_DELIVERY=live is refused/,
    );
  });

  it("throws on RATE_LIMIT=off in production", () => {
    expect(
      validateWith({ NODE_ENV: "production", RATE_LIMIT: "off", SENTRY_DSN: "disabled" }),
    ).toThrow(/RATE_LIMIT=off is refused in production/);
  });

  it("throws on CACHE=off in production", () => {
    expect(
      validateWith({ NODE_ENV: "production", CACHE: "off", SENTRY_DSN: "disabled" }),
    ).toThrow(/CACHE=off is refused in production/);
  });

  it("passes on the development defaults", () => {
    expect(validateWith({ NODE_ENV: "development" })).not.toThrow();
  });
});

describe("where the switches may be set", () => {
  const root = path.join(__dirname, "../../..");
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

  it.each(["docker-compose.yml", "config/env.prd.keys", "config/env.dev.keys"])(
    "%s sets none of them",
    (rel) => {
      const text = read(rel);
      for (const name of RUNTIME_SWITCH_NAMES) {
        expect(text).not.toMatch(new RegExp(`\\b${name}\\b`));
      }
    },
  );

  describe("docker-compose.local-verify.yml", () => {
    const verify = read("docker-compose.local-verify.yml");
    const apiEnv = verify.match(/x-api-dev-env: &api-dev-env\n((?: {2}- .*\n)+)/)?.[1];
    const pollerEnv = verify.match(/\n {2}poller:\n {4}environment:\n((?: {6}- .*\n)+)/)?.[1];

    it.each([
      ["the api replicas", apiEnv],
      ["the poller", pollerEnv],
    ])("%s suppress push and stop the building sync", (_label, env) => {
      expect(env).toBeDefined();
      expect(env).toMatch(/- PUSH_DELIVERY=suppressed\n/);
      expect(env).toMatch(/- BUILDING_SYNC=off\n/);
    });
  });
});
