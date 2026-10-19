import { Injectable } from "@nestjs/common";
import { MiniappsManifestService } from "../manifest/miniapps-manifest.service";
import { MiniappsService } from "../miniapps.service";
import type { MiniAppDetail } from "../miniapps.wire";
import { toDetailResponse } from "./miniapps-catalog.mapper";
import type { MiniAppIndex } from "./miniapps-catalog.wire";

@Injectable()
export class MiniappsCatalogService {
  constructor(
    private readonly miniApps: MiniappsService,
    private readonly manifests: MiniappsManifestService,
  ) {}

  index(): MiniAppIndex {
    return { version: this.miniApps.version, miniApps: [...this.miniApps.list] };
  }

  async detail(id: string): Promise<MiniAppDetail | null> {
    const detail = this.miniApps.getDetail(id);
    if (!detail) return null;
    return toDetailResponse(detail, await this.manifests.shellFieldsFor(detail.startUrl));
  }
}
