/**
 * A BusRegistryService over an in-memory repository, seeded from the committed
 * snapshot as a boot would seed it: what a spec of a reader of the registry
 * (the realtime group, the bus config, the ui) builds its service on.
 */
import { BusRegistryService } from "../../../src/bus/registry/bus-registry.service";
import type { BusRegistryRepository } from "../../../src/bus/registry/bus-registry.repository";
import { FakeBusRegistryRepository } from "../fakes/bus/bus-registry.repository.fake";
import { asReal } from "../fakes/public-of";

const SEEDED_AT = new Date("2026-10-17T12:00:00Z");

export async function seededBusRegistryService(repository = new FakeBusRegistryRepository()): Promise<BusRegistryService> {
  const registry = new BusRegistryService(asReal<BusRegistryRepository>(repository), { now: () => SEEDED_AT });
  await registry.onModuleInit();
  return registry;
}
