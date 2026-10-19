import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { mongoCollection } from "../../infra/mongo";
import type { ShellConfig } from "../miniapps.wire";
import type { MiniAppManifestDoc, StoredManifestShell } from "./miniapps-manifest.document";

@Injectable()
export class MiniappsManifestRepository {
  async upsertManifest(origin: string, shell: Partial<ShellConfig>, fetchedAt: Date): Promise<void> {
    await this.manifests().updateOne({ _id: origin }, { $set: { shell, fetchedAt } }, { upsert: true });
  }

  listManifests(origins: readonly string[]): Promise<StoredManifestShell[]> {
    return this.manifests()
      .find({ _id: { $in: [...origins] } }, { projection: { shell: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS })
      .toArray();
  }

  private manifests(): Collection<MiniAppManifestDoc> {
    return mongoCollection<MiniAppManifestDoc>(config.miniapps.dbName, config.miniapps.collections.manifests);
  }
}
