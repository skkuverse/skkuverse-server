import { Injectable } from "@nestjs/common";
import { BuildingPlaceService } from "../building-place.service";
import { toPlaceDisplay, toStoredPlace } from "./building-place-display.rules";
import type { PlaceDisplay } from "./building-place-display.types";

// SEE: docs/explanation/building-architecture.md ("Invariants"): the door a notice flow shows its places through.
@Injectable()
export class BuildingPlaceDisplayService {
  constructor(private readonly placeService: BuildingPlaceService) {}

  async describePlaces(placeIds: readonly string[]): Promise<Array<PlaceDisplay | null>> {
    const index = await this.placeService.findPlaceIndex();
    return placeIds.map((placeId) => {
      const place = toStoredPlace(placeId);
      return place && toPlaceDisplay(place, index);
    });
  }
}
