import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../../infra/config";
import { mongoCollection } from "../../infra/mongo";
import type { ShellConfig } from "../miniapps.wire";
import type { MiniAppManifestDoc } from "./miniapps-manifest.document";

@Injectable()
export class MiniappsManifestRepository {
  async upsertManifest(origin: string, shell: Partial<ShellConfig>, fetchedAt: Date): Promise<void> {
    await this.manifests().updateOne({ _id: origin }, { $set: { shell, fetchedAt } }, { upsert: true });
  }

  private manifests(): Collection<MiniAppManifestDoc> {
    return mongoCollection<MiniAppManifestDoc>(config.miniapps.dbName, config.miniapps.collections.manifests);
  }
}
