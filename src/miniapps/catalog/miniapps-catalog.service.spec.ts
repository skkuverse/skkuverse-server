/**
 * MiniappsCatalogService over the real registry and a fake manifest client.
 * What it guards: the index serves the registry's version and ordered list, an
 * unknown id answers null without asking for a manifest, and a known id's
 * detail takes the manifest's shell fields over the registry's.
 */
import { FakeMiniappsCatalogClient } from "../../../__tests__/helpers/fakes/miniapps/miniapps-catalog.client.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { MiniappsService } from "../miniapps.service";
import type { MiniappsCatalogClient } from "./miniapps-catalog.client";
import { DEFAULT_SHELL } from "./miniapps-catalog.constants";
import { MiniappsCatalogService } from "./miniapps-catalog.service";

const registry = new MiniappsService();
let client: FakeMiniappsCatalogClient;
let service: MiniappsCatalogService;

beforeEach(() => {
  client = new FakeMiniappsCatalogClient();
  service = new MiniappsCatalogService(registry, asReal<MiniappsCatalogClient>(client));
});

describe("MiniappsCatalogService.index", () => {
  it("serves the registry's version and its ordered list", () => {
    // Act & Assert
    expect(service.index()).toEqual({ version: registry.version, miniApps: [...registry.list] });
  });
});

describe("MiniappsCatalogService.isRegistered", () => {
  it.each([
    ["hssc", true],
    ["no-such-app", false],
  ])("%s → %s", (id, expected) => {
    // Act & Assert
    expect(service.isRegistered(id)).toBe(expected);
  });
});

describe("MiniappsCatalogService.detail", () => {
  it("answers null for an unknown id, without asking for a manifest", async () => {
    // Act
    const detail = await service.detail("no-such-app");

    // Assert
    expect(detail).toBeNull();
    expect(client.requests).toEqual([]);
  });

  it("serves the registry detail with the manifest's shell fields over the defaults", async () => {
    // Arrange
    client.shellFields["mukja"] = { bar: "none" };

    // Act
    const detail = await service.detail("mukja");

    // Assert
    expect(detail).toEqual({ ...registry.getDetail("mukja"), shell: { ...DEFAULT_SHELL, bar: "none" } });
  });
});
