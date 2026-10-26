/**
 * PUSH_DELIVERY / CACHE / SHUTTLE_ETA / SUBWAY / REGIONAL_BUS / GBIS /
 * NOTICE_OVERVIEW
 * (src/infra/runtime-switches.ts).
 *
 * Two halves. The resolver table pins what each mode defaults to and which
 * combinations refuse to boot. The file checks pin where the switches may and
 * may not be set: production's compose file and Doppler key lists never carry
 * one (production must run on the defaults), and local verify — which runs the
 * production image on a laptop holding the real Cloud Function URL — always
 * suppresses push, the directions calls, the subway pollers, the regional
 * bus pollers and the GBIS seat pollers, and its api
 * replicas never call the ai for a notice overview.
 *
 * NOTICE_OVERVIEW is the one switch production defaults off: every overview
 * spends an LLM call, and production serves none until the route has a cost
 * guard, so production turns it back on by its default, not by its compose file.
 *
 * RATE_LIMIT is no switch (ADR 0023): the perimeter mode chooses the limiter, and every implementation limits.
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
    // Act & Assert
    expect(runtimeMode(nodeEnv)).toBe(mode);
  });
});

describe("resolveRuntimeSwitches defaults", () => {
  it("production keeps every side effect and cache on, and serves no notice overview", () => {
    // Act & Assert
    expect(resolveRuntimeSwitches({}, "production")).toEqual({
      switches: {
        pushDelivery: "live",
        cacheEnabled: true,
        shuttleEtaEnabled: true,
        subwayEnabled: true,
        regionalBusEnabled: true,
        gbisEnabled: true,
        noticeOverviewEnabled: false,
      },
      errors: [],
    });
  });

  it("development turns every outbound side effect and the caches off, and keeps the notice overview on", () => {
    // Act & Assert
    expect(resolveRuntimeSwitches({}, "development")).toEqual({
      switches: {
        pushDelivery: "suppressed",
        cacheEnabled: false,
        shuttleEtaEnabled: false,
        subwayEnabled: false,
        regionalBusEnabled: false,
        gbisEnabled: false,
        noticeOverviewEnabled: true,
      },
      errors: [],
    });
  });

  it("test keeps production's defaults (fetch is mocked, limiter tests expect 429)", () => {
    // Act & Assert
    expect(resolveRuntimeSwitches({}, "test").switches).toEqual(
      resolveRuntimeSwitches({}, "production").switches,
    );
  });

  it("treats an empty value as unset", () => {
    // Act
    const { switches, errors } = resolveRuntimeSwitches(
      { PUSH_DELIVERY: "", CACHE: "" },
      "development",
    );

    // Assert
    expect(errors).toEqual([]);
    expect(switches.pushDelivery).toBe("suppressed");
  });
});

describe("resolveRuntimeSwitches overrides", () => {
  it("development may turn the caches on", () => {
    // Act
    const { switches, errors } = resolveRuntimeSwitches({ CACHE: "on" }, "development");

    // Assert
    expect(errors).toEqual([]);
    expect(switches.cacheEnabled).toBe(true);
  });

  it("reads no RATE_LIMIT, in any mode, so no value of it switches a limiter off or refuses a boot", () => {
    // Act
    const resolved = (["production", "development", "test"] as const).flatMap((mode) => ["off", "on", "true"].map((value) => resolveRuntimeSwitches({ RATE_LIMIT: value }, mode)));

    // Assert
    expect(RUNTIME_SWITCH_NAMES).not.toContain("RATE_LIMIT");
    expect(resolved.map(({ errors }) => errors)).toEqual(resolved.map(() => []));
    expect(resolved.map(({ switches }) => Object.keys(switches).filter((key) => /rate/i.test(key)))).toEqual(resolved.map(() => []));
  });

  it("development may turn the shuttle estimates on, and production may turn them off", () => {
    // Act & Assert
    const dev = resolveRuntimeSwitches({ SHUTTLE_ETA: "on" }, "development");
    expect(dev.errors).toEqual([]);
    expect(dev.switches.shuttleEtaEnabled).toBe(true);
    const prod = resolveRuntimeSwitches({ SHUTTLE_ETA: "off" }, "production");
    expect(prod.errors).toEqual([]);
    expect(prod.switches.shuttleEtaEnabled).toBe(false);
  });

  it("development may turn the subway pollers on, and production may turn them off", () => {
    // Act
    const dev = resolveRuntimeSwitches({ SUBWAY: "on" }, "development");
    const prod = resolveRuntimeSwitches({ SUBWAY: "off" }, "production");

    // Assert
    expect(dev).toEqual({ switches: expect.objectContaining({ subwayEnabled: true }), errors: [] });
    expect(prod).toEqual({ switches: expect.objectContaining({ subwayEnabled: false }), errors: [] });
  });

  it("development may turn the regional bus pollers on, and production may turn them off", () => {
    // Act
    const dev = resolveRuntimeSwitches({ REGIONAL_BUS: "on" }, "development");
    const prod = resolveRuntimeSwitches({ REGIONAL_BUS: "off" }, "production");

    // Assert
    expect(dev).toEqual({ switches: expect.objectContaining({ regionalBusEnabled: true }), errors: [] });
    expect(prod).toEqual({ switches: expect.objectContaining({ regionalBusEnabled: false }), errors: [] });
  });

  it("development may turn the GBIS seat pollers on, and production may turn them off", () => {
    // Act
    const dev = resolveRuntimeSwitches({ GBIS: "on" }, "development");
    const prod = resolveRuntimeSwitches({ GBIS: "off" }, "production");

    // Assert
    expect(dev).toEqual({ switches: expect.objectContaining({ gbisEnabled: true }), errors: [] });
    expect(prod).toEqual({ switches: expect.objectContaining({ gbisEnabled: false }), errors: [] });
  });

  it("production may turn the notice overview on, and development may turn it off", () => {
    // Act
    const prod = resolveRuntimeSwitches({ NOTICE_OVERVIEW: "on" }, "production");
    const dev = resolveRuntimeSwitches({ NOTICE_OVERVIEW: "off" }, "development");

    // Assert
    expect(prod).toEqual({ switches: expect.objectContaining({ noticeOverviewEnabled: true }), errors: [] });
    expect(dev).toEqual({ switches: expect.objectContaining({ noticeOverviewEnabled: false }), errors: [] });
  });

  it("refuses PUSH_DELIVERY=live in development, and stays suppressed", () => {
    // Act
    const { switches, errors } = resolveRuntimeSwitches({ PUSH_DELIVERY: "live" }, "development");

    // Assert
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/PUSH_DELIVERY=live is refused/);
    expect(switches.pushDelivery).toBe("suppressed");
  });

  it("production may suppress push (what local verify sets)", () => {
    // Act
    const { switches, errors } = resolveRuntimeSwitches({ PUSH_DELIVERY: "suppressed" }, "production");

    // Assert
    expect(errors).toEqual([]);
    expect(switches.pushDelivery).toBe("suppressed");
  });

  it("refuses CACHE=off in production, and keeps the caches on", () => {
    // Act
    const { switches, errors } = resolveRuntimeSwitches({ CACHE: "off" }, "production");

    // Assert
    expect(errors).toEqual(["CACHE=off is refused in production"]);
    expect(switches.cacheEnabled).toBe(true);
  });

  it.each([
    ["PUSH_DELIVERY", "dry-run"],
    ["CACHE", "no-store"],
    ["SHUTTLE_ETA", "true"],
    ["SUBWAY", "yes"],
    ["REGIONAL_BUS", "true"],
    ["GBIS", "yes"],
    ["NOTICE_OVERVIEW", "true"],
  ])("reports %s=%s instead of coercing it", (name, value) => {
    // Act & Assert
    for (const mode of ["production", "development", "test"] as const) {
      const { errors } = resolveRuntimeSwitches({ [name]: value }, mode);
      expect(errors).toEqual([expect.stringContaining(`${name} must be one of`)]);
    }
  });
});

describe("validateEnv refuses an invalid switch", () => {
  const touched = ["NODE_ENV", "PERIMETER_MODE", "SENTRY_DSN", ...RUNTIME_SWITCH_NAMES];

  /** validateEnv() under exactly `env` (NODE_ENV is read at module load). */
  function validateWith(env: Record<string, string>): () => void {
    return () => {
      const saved = new Map(touched.map((k) => [k, process.env[k]]));
      try {
        for (const k of touched) delete process.env[k];
        Object.assign(process.env, env);
        jest.isolateModules(() => {
          require("../../../src/infra/required-env").validateEnv();
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
    // Act & Assert
    expect(validateWith({ NODE_ENV: "development", PUSH_DELIVERY: "live" })).toThrow(
      /Invalid runtime switch[\s\S]*PUSH_DELIVERY=live is refused/,
    );
  });

  it("throws on CACHE=off in production", () => {
    // Act & Assert
    expect(
      validateWith({ NODE_ENV: "production", CACHE: "off", SENTRY_DSN: "disabled" }),
    ).toThrow(/CACHE=off is refused in production/);
  });

  it("passes on the development defaults", () => {
    // Act & Assert
    expect(validateWith({ NODE_ENV: "development", PERIMETER_MODE: "local-dev" })).not.toThrow();
  });
});

describe("where the switches may be set", () => {
  const root = path.join(__dirname, "../../..");
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

  it.each(["docker-compose.yml", "config/env.prd.keys", "config/env.dev.keys"])(
    "%s sets none of them",
    (rel) => {
      // Arrange
      const text = read(rel);

      // Assert
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
    ])("%s suppress push and the directions calls", (_label, env) => {
      // Assert
      expect(env).toBeDefined();
      expect(env).toMatch(/- PUSH_DELIVERY=suppressed\n/);
      expect(env).toMatch(/- SHUTTLE_ETA=off\n/);
    });

    it.each([
      ["the api replicas", apiEnv],
      ["the poller", pollerEnv],
    ])("%s run no subway poller", (_label, env) => {
      // Assert
      expect(env).toMatch(/- SUBWAY=off\n/);
    });

    it.each([
      ["the api replicas", apiEnv],
      ["the poller", pollerEnv],
    ])("%s run no regional bus poller", (_label, env) => {
      // Assert
      expect(env).toMatch(/- REGIONAL_BUS=off\n/);
    });

    it.each([
      ["the api replicas", apiEnv],
      ["the poller", pollerEnv],
    ])("%s run no GBIS seat poller", (_label, env) => {
      // Assert
      expect(env).toMatch(/- GBIS=off\n/);
    });

    it("the api replicas call no ai for a notice overview", () => {
      // Assert
      expect(apiEnv).toMatch(/- NOTICE_OVERVIEW=off\n/);
    });
  });
});
