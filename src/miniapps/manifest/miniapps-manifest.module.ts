import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { MiniappsManifestClient } from "./miniapps-manifest.client";
import { MiniappsManifestPoller } from "./miniapps-manifest.poller";
import { MiniappsManifestRepository } from "./miniapps-manifest.repository";
import { MiniappsManifestService } from "./miniapps-manifest.service";

@Module({
  providers: [MiniappsManifestClient, MiniappsManifestRepository, MiniappsManifestService, MiniappsManifestPoller, Clock],
  exports: [MiniappsManifestService],
})
export class MiniappsManifestModule {}
