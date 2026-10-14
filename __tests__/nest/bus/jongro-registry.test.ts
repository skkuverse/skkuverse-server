/**
 * The jongroRoutesProvider useFactory: it must surface the registry at
 * bootstrap (fail-loud) and reject an empty/invalid array with NO silent ?? [].
 */

import { jongroRoutes } from "../../../src/bus/bus.config";
import { jongroRoutesProvider } from "../../../src/bus/registry/jongro-registry.provider";

describe("jongroRoutesProvider — fail-loud factory (NO silent ?? [])", () => {
  it("returns the validated registry (non-empty, frozen)", () => {
    const factory = (jongroRoutesProvider as { useFactory: () => ReadonlyArray<unknown> })
      .useFactory;
    const routes = factory();
    expect(Array.isArray(routes)).toBe(true);
    expect(routes.length).toBe(3);
    // Same object as the re-exported registry.
    expect(routes).toBe(jongroRoutes);
  });
});
