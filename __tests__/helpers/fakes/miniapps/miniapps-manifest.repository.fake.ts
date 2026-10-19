/**
 * In-memory MiniappsManifestRepository over miniapp_manifests, keyed by origin
 * as the real upsert is, and read as the real `find` is (both pinned in
 * miniapps-manifest.repository.spec.ts): a write replaces the origin's shell
 * and fetch time, or inserts the document; a read returns the documents of the
 * origins asked for, projected to `_id` and `shell`. `reads` counts the reads;
 * `failWith` makes every call reject.
 */
import type { MiniAppManifestDoc, StoredManifestShell } from "../../../../src/miniapps/manifest/miniapps-manifest.document";
import type { MiniappsManifestRepository } from "../../../../src/miniapps/manifest/miniapps-manifest.repository";
import type { ShellConfig } from "../../../../src/miniapps/miniapps.wire";
import type { PublicOf } from "../public-of";

export class FakeMiniappsManifestRepository implements PublicOf<MiniappsManifestRepository> {
  manifests = new Map<string, MiniAppManifestDoc>();
  reads = 0;
  failWith: Error | null = null;

  async upsertManifest(origin: string, shell: Partial<ShellConfig>, fetchedAt: Date): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.manifests.set(origin, { _id: origin, shell: { ...shell }, fetchedAt });
  }

  async listManifests(origins: readonly string[]): Promise<StoredManifestShell[]> {
    this.reads += 1;
    if (this.failWith) throw this.failWith;
    return [...this.manifests.values()].filter((doc) => origins.includes(doc._id)).map((doc) => ({ _id: doc._id, shell: { ...doc.shell } }));
  }
}
