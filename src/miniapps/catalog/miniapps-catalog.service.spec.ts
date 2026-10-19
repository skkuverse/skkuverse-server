/**
 * MiniappsCatalogService over the real registry and the manifest service over
 * the stored-manifest fake. What it guards: the index serves the registry's
 * version and ordered list, an unknown id answers null without reading a
 * manifest, and a known id's detail takes its stored manifest's shell fields
 * over the registry's.
 */
import { FakeMiniappsManifestClient } from "../../../__tests__/helpers/fakes/miniapps/miniapps-manifest.client.fake";
import { FakeMiniappsManifestRepository } from "../../../__tests__/helpers/fakes/miniapps/miniapps-manifest.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { MiniappsManifestClient } from "../manifest/miniapps-manifest.client";
import type { MiniappsManifestRepository } from "../manifest/miniapps-manifest.repository";
import { MiniappsManifestService } from "../manifest/miniapps-manifest.service";
import { fixtureMiniappsService } from "../../../__tests__/helpers/miniapps/registry-fixture";
import { DEFAULT_SHELL } from "./miniapps-catalog.constants";
import { MiniappsCatalogService } from "./miniapps-catalog.service";

const registry = fixtureMiniappsService();
const CLOCK = { now: () => new Date("2026-10-20T01:00:00Z") };
let manifests: FakeMiniappsManifestRepository;
let service: MiniappsCatalogService;

beforeEach(() => {
  manifests = new FakeMiniappsManifestRepository();
  const manifestService = new MiniappsManifestService(
    asReal<MiniappsManifestClient>(new FakeMiniappsManifestClient()),
    asReal<MiniappsManifestRepository>(manifests),
    CLOCK,
  );
  service = new MiniappsCatalogService(registry, manifestService);
});

describe("MiniappsCatalogService.index", () => {
  it("serves the registry's version and its ordered list", async () => {
    // Arrange
    const snapshot = await registry.current();

    // Act & Assert
    expect(await service.index()).toEqual({ version: snapshot.version, miniApps: [...snapshot.indexEntries] });
  });
});

describe("MiniappsCatalogService.detail", () => {
  it("answers null for an unknown id, without asking for a manifest", async () => {
    // Act
    const detail = await service.detail("no-such-app");

    // Assert
    expect(detail).toBeNull();
    expect(manifests.reads).toBe(0);
  });

  it("serves the registry detail with the manifest's shell fields over the defaults", async () => {
    // Arrange
    await manifests.upsertManifest("https://mukja.mini.skkuverse.com", { bar: "none" }, CLOCK.now());

    // Act
    const detail = await service.detail("mukja");

    // Assert
    expect(detail).toEqual({ ...(await registry.current()).detailOf("mukja"), shell: { ...DEFAULT_SHELL, bar: "none" } });
  });
});
