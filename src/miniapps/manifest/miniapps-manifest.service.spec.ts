/**
 * MiniappsManifestService over the manifest client and repository fakes and a
 * fixed clock. What it guards: a refresh stores the origin's fetched shell
 * fields with the time it ran; a failed fetch rejects, so the poller reports
 * it, and writes nothing, so the last good manifest stays; an empty shell is
 * stored as `{}`. For wave A of move-miniapp-registry the catalog still
 * fetches through this service: it asks for an origin's shell fields and
 * which first-party origin a start URL is on.
 */
import { FakeMiniappsManifestClient } from "../../../__tests__/helpers/fakes/miniapps/miniapps-manifest.client.fake";
import { FakeMiniappsManifestRepository } from "../../../__tests__/helpers/fakes/miniapps/miniapps-manifest.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { MiniappsManifestClient } from "./miniapps-manifest.client";
import type { MiniappsManifestRepository } from "./miniapps-manifest.repository";
import { MiniappsManifestService } from "./miniapps-manifest.service";

const MUKJA = "https://mukja.mini.skkuverse.com";
const EARLIER = new Date("2026-10-20T00:56:00Z");
const NOW = new Date("2026-10-20T01:00:00Z");

let client: FakeMiniappsManifestClient;
let repository: FakeMiniappsManifestRepository;
let service: MiniappsManifestService;

beforeEach(() => {
  client = new FakeMiniappsManifestClient();
  repository = new FakeMiniappsManifestRepository();
  service = new MiniappsManifestService(asReal<MiniappsManifestClient>(client), asReal<MiniappsManifestRepository>(repository), { now: () => NOW });
});

describe("MiniappsManifestService.refresh", () => {
  it("stores the origin's fetched shell fields with the time it ran", async () => {
    // Arrange
    client.answers.set(MUKJA, { bar: "top", background: "#F2F4F6" });

    // Act
    await service.refresh(MUKJA);

    // Assert
    expect(client.calls).toEqual([MUKJA]);
    expect(repository.manifests.get(MUKJA)).toEqual({ _id: MUKJA, shell: { bar: "top", background: "#F2F4F6" }, fetchedAt: NOW });
    expect([...repository.manifests.keys()]).toEqual([MUKJA]);
  });

  it("rejects on a failed fetch and leaves the stored manifest unchanged", async () => {
    // Arrange
    const stored = { _id: MUKJA, shell: { bar: "top" as const }, fetchedAt: EARLIER };
    repository.manifests.set(MUKJA, stored);
    client.answers.set(MUKJA, new Error("manifest 503 from https://mukja.mini.skkuverse.com"));

    // Act & Assert
    await expect(service.refresh(MUKJA)).rejects.toThrow("manifest 503 from https://mukja.mini.skkuverse.com");
    expect(repository.manifests.get(MUKJA)).toEqual({ _id: MUKJA, shell: { bar: "top" }, fetchedAt: EARLIER });
  });

  it("stores an empty shell as {}", async () => {
    // Act
    await service.refresh(MUKJA);

    // Assert
    expect(repository.manifests.get(MUKJA)).toEqual({ _id: MUKJA, shell: {}, fetchedAt: NOW });
  });

  it("rejects when the store fails", async () => {
    // Arrange
    repository.failWith = new Error("write failed");

    // Act & Assert
    await expect(service.refresh(MUKJA)).rejects.toThrow("write failed");
  });
});

describe("MiniappsManifestService.fetchShellFields", () => {
  it("answers the origin's fetched shell fields without storing them", async () => {
    // Arrange
    client.answers.set(MUKJA, { bar: "none" });

    // Act & Assert
    await expect(service.fetchShellFields(MUKJA)).resolves.toEqual({ bar: "none" });
    expect(repository.manifests.size).toBe(0);
  });
});

describe("MiniappsManifestService.firstPartyOriginOf", () => {
  it.each([
    ["https://mukja.mini.skkuverse.com/", MUKJA],
    ["https://eskara.miniapp.skkuverse.com/eskara", "https://eskara.miniapp.skkuverse.com"],
    ["https://student.skku.edu/student/notice2.do", null],
    ["https://unlisted.mini.skkuverse.com/", null],
  ])("answers %s on the first-party origins of src/infra/origins.ts as %s", (startUrl, origin) => {
    // Act & Assert
    expect(service.firstPartyOriginOf(startUrl)).toBe(origin);
  });
});
