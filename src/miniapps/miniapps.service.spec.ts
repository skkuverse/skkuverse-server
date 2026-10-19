/**
 * MiniappsService, the mini app registry's door (ADR 0010 D1;
 * move-miniapp-registry design D3, D5), over an in-memory dataset store and a
 * fixed clock. current() is the frozen snapshot of the stored `miniapps`
 * dataset, read through the dataset read contract (ADR 0013 D6): a push is
 * served once DATASET_CACHE_TTL_MS has passed, an invalid revision after a
 * good one keeps the good one, and with no good registry ever read it answers
 * MINIAPP_REGISTRY_UNAVAILABLE (503). A stored registry whose first-party
 * owners disagree with src/infra/origins.ts still serves, and the mismatch is
 * logged at error once per revision. The grammar (targets, emoji, logos) is
 * code, so it answers with no read.
 *
 * Until every reader awaits current() (move-miniapp-registry tasks 9.x), the
 * synchronous getters read the committed files; the last block pins that they
 * answer what current() answers for revision 1, the fixture made from them.
 *
 * The cached loader reads `Date.now()`, so the TTL is crossed with Jest's fake
 * system time; the loader's clock stays the injected one.
 */
jest.mock("../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { FakeMiniappsRepository } from "../../__tests__/helpers/fakes/miniapps/miniapps.repository.fake";
import { asReal } from "../../__tests__/helpers/fakes/public-of";
import { fixtureRegistry } from "../../__tests__/helpers/miniapps/registry-fixture";
import type { Clock } from "../infra/clock";
import logger from "../infra/logger";
import { DATASET_CACHE_TTL_MS } from "../shared/dataset.constants";
import type { MiniappsRepository } from "./miniapps.repository";
import { MiniappsService } from "./miniapps.service";

const NOW = new Date("2026-10-20T03:00:00.000Z");
const clock: Clock = { now: () => NOW };
const mockedLogger = logger as unknown as Record<"info" | "warn" | "error", jest.Mock>;
const callsOf = (event: string) => mockedLogger.error.mock.calls.filter(([fields]) => fields?.event === event).map(([fields]) => fields);

/** The fixture with one more third-party mini app, `wave-run`, registered. */
function withWaveRun(): ReturnType<typeof fixtureRegistry> {
  const registry = fixtureRegistry();
  registry.index.miniApps.push({ id: "wave-run", name: "Wave Run", order: 50, homeLogo: { kind: "emoji", emoji: "🌊" } });
  registry.details["wave-run"] = { version: 1, id: "wave-run", startUrl: "https://wave-run.example.com/", verified: false, relatedLinks: [] };
  return registry;
}

/** The fixture with `inja`, the owner of a first-party origin, removed. */
function withoutInja(): ReturnType<typeof fixtureRegistry> {
  const registry = fixtureRegistry();
  registry.index.miniApps = registry.index.miniApps.filter((entry) => entry.id !== "inja");
  delete registry.details.inja;
  return registry;
}

let repository: FakeMiniappsRepository;
let service: MiniappsService;

beforeEach(() => {
  jest.clearAllMocks();
  repository = new FakeMiniappsRepository();
  service = new MiniappsService(asReal<MiniappsRepository>(repository), clock);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("MiniappsService.current", () => {
  it("serves the stored registry as a snapshot of its revision", async () => {
    // Arrange
    repository.storeRegistry(fixtureRegistry());

    // Act
    const registry = await service.current();

    // Assert
    expect(registry.revision).toBe(1);
    expect(registry.isRegistered("skkuzine")).toBe(true);
    expect(registry.indexEntries.map((entry) => entry.id)[0]).toBe("eskara-2026");
  });

  it("serves a push once the TTL has passed, and not before", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    repository.storeRegistry(fixtureRegistry());
    await service.current();
    repository.storeRegistry(withWaveRun());

    // Act
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS - 1);
    const beforeTtl = await service.current();
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS);
    const atTtl = await service.current();

    // Assert
    expect({ revision: beforeTtl.revision, registered: beforeTtl.isRegistered("wave-run") }).toEqual({ revision: 1, registered: false });
    expect({ revision: atTtl.revision, registered: atTtl.isRegistered("wave-run") }).toEqual({ revision: 2, registered: true });
  });

  it("keeps serving the good revision when the next one fails its schema", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    repository.storeRegistry(fixtureRegistry());
    const good = await service.current();
    const broken = withWaveRun();
    delete broken.details["wave-run"];
    repository.storeRegistry(broken);

    // Act
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS);
    const served = await service.current();

    // Assert
    expect(served).toBe(good);
  });

  it("answers MINIAPP_REGISTRY_UNAVAILABLE (503) when no registry is stored", async () => {
    // Act & Assert
    await expect(service.current()).rejects.toMatchObject({ code: "MINIAPP_REGISTRY_UNAVAILABLE", httpStatus: 503 });
  });

  it("answers MINIAPP_REGISTRY_UNAVAILABLE (503) on a first read that fails, logging the failure", async () => {
    // Arrange
    const failure = new Error("server selection timed out");
    repository.failWith = failure;

    // Act & Assert
    await expect(service.current()).rejects.toMatchObject({ code: "MINIAPP_REGISTRY_UNAVAILABLE", httpStatus: 503 });
    expect(callsOf("miniapps.registry.read_failed")).toEqual([expect.objectContaining({ err: failure })]);
  });

  it("serves a registry that lacks a first-party owner, logging the mismatch at error", async () => {
    // Arrange
    repository.storeRegistry(withoutInja());

    // Act
    const registry = await service.current();

    // Assert
    expect(registry.isRegistered("mukja")).toBe(true);
    expect(registry.isRegistered("inja")).toBe(false);
    expect(callsOf("miniapps.registry.owner_mismatch")).toEqual([
      expect.objectContaining({ revision: 1, path: "details", reason: expect.stringContaining('"inja"') }),
    ]);
  });

  it("logs an owner mismatch once per revision, however often it reloads", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    repository.storeRegistry(withoutInja());

    // Act
    for (let reload = 0; reload < 3; reload++) {
      jest.setSystemTime(NOW.getTime() + reload * DATASET_CACHE_TTL_MS);
      await service.current();
    }
    repository.storeRegistry(withoutInja());
    jest.setSystemTime(NOW.getTime() + 3 * DATASET_CACHE_TTL_MS);
    await service.current();

    // Assert
    expect(repository.readCount).toBe(4);
    expect(callsOf("miniapps.registry.owner_mismatch").map((fields) => fields.revision)).toEqual([1, 2]);
  });

  it("logs no mismatch for the fixture, whose owners agree with the code", async () => {
    // Arrange
    repository.storeRegistry(fixtureRegistry());

    // Act
    await service.current();

    // Assert
    expect(callsOf("miniapps.registry.owner_mismatch")).toEqual([]);
  });
});

describe("MiniappsService.findCurrent", () => {
  it("answers the snapshot current() serves", async () => {
    // Arrange
    repository.storeRegistry(fixtureRegistry());

    // Act
    const registry = await service.findCurrent();

    // Assert
    expect(registry).toBe(await service.current());
  });

  it("answers null where current() answers MINIAPP_REGISTRY_UNAVAILABLE, for a reader that serves without it", async () => {
    // Arrange
    repository.failWith = new Error("server selection timed out");

    // Act
    const registry = await service.findCurrent();

    // Assert
    expect(registry).toBeNull();
  });

  it("lets a fault in this code through rather than answering null", async () => {
    // Arrange
    const fault = new TypeError("cannot read properties of undefined");
    repository.findRegistry = async () => {
      throw fault;
    };

    // Act & Assert
    await expect(service.findCurrent()).rejects.toBe(fault);
  });
});

describe("MiniappsService grammar", () => {
  it("parses targets, counts emoji and resolves logos with no read", () => {
    // Act
    const target = service.parseTarget("eskara-2026/eskara/wristband");
    const isEmoji = service.isSingleEmoji("👩‍🍳");
    const logo = service.resolveLogo({ kind: "remote", path: "/miniapps/hssc.png" });

    // Assert
    expect(target).toEqual({ id: "eskara-2026", path: "/eskara/wristband" });
    expect(isEmoji).toBe(true);
    expect(logo).toEqual({ kind: "remote", uri: "https://skkuverse.com/miniapps/hssc.png" });
    expect(repository.readCount).toBe(0);
  });
});
