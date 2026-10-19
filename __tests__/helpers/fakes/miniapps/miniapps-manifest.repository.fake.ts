/**
 * In-memory MiniappsManifestRepository over miniapp_manifests, keyed by origin
 * as the real upsert is (pinned in miniapps-manifest.repository.spec.ts): a
 * write replaces the origin's shell and fetch time, or inserts the document.
 * `failWith` makes every call reject.
 */
import type { MiniAppManifestDoc } from "../../../../src/miniapps/manifest/miniapps-manifest.document";
import type { MiniappsManifestRepository } from "../../../../src/miniapps/manifest/miniapps-manifest.repository";
import type { ShellConfig } from "../../../../src/miniapps/miniapps.wire";
import type { PublicOf } from "../public-of";

export class FakeMiniappsManifestRepository implements PublicOf<MiniappsManifestRepository> {
  manifests = new Map<string, MiniAppManifestDoc>();
  failWith: Error | null = null;

  async upsertManifest(origin: string, shell: Partial<ShellConfig>, fetchedAt: Date): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.manifests.set(origin, { _id: origin, shell: { ...shell }, fetchedAt });
  }
}
