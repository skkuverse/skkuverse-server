import { Injectable } from "@nestjs/common";
import { BuildingPlaceService } from "../building-place.service";
import type { ResolvedPlace } from "../building-place.types";
import { resolvePlace } from "./building-place-resolve.rules";
import type { PlaceMention } from "./building-place-resolve.types";

// SEE: docs/explanation/building-architecture.md ("Invariants"): the door a notice flow resolves its places through.
@Injectable()
export class BuildingPlaceResolveService {
  constructor(private readonly placeService: BuildingPlaceService) {}

  async resolvePlaces(mentions: readonly PlaceMention[]): Promise<ResolvedPlace[]> {
    const index = await this.placeService.findPlaceIndex();
    return mentions.map((mention) => resolvePlace(mention, index));
  }
}
