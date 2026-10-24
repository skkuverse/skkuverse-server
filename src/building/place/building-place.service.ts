import { Injectable } from "@nestjs/common";
import { createLogThrottle } from "../../infra/log-throttle";
import logger from "../../infra/logger";
import type { BuildingDoc } from "../building.document";
import { BuildingRepository } from "../building.repository";
import { placeLexicon } from "./building-place.config";
import type { PlaceSpace } from "./building-place.document";
import { BuildingPlaceRepository } from "./building-place.repository";
import { toPlaceIndex } from "./building-place.rules";
import type { PlaceIndex } from "./building-place.types";

// WHY: the index is rebuilt once per cache reload, so the same gaps would be reported every few minutes.
const LEXICON_GAPS_LOG_INTERVAL_MS = 60 * 60 * 1000;

// WHY: both reads return the same arrays until their cache reloads, so the index is rebuilt only for new data.
@Injectable()
export class BuildingPlaceService {
  private readonly gapsThrottle = createLogThrottle(LEXICON_GAPS_LOG_INTERVAL_MS);
  private built: { buildings: readonly BuildingDoc[]; spaces: readonly PlaceSpace[]; index: PlaceIndex } | null = null;

  constructor(
    private readonly buildingRepository: BuildingRepository,
    private readonly repository: BuildingPlaceRepository,
  ) {}

  async findPlaceIndex(): Promise<PlaceIndex> {
    const [buildings, spaces] = await Promise.all([this.buildingRepository.listBuildings(), this.repository.listSpaces()]);
    if (this.built?.buildings === buildings && this.built.spaces === spaces) return this.built.index;
    const index = toPlaceIndex({ buildings, spaces }, placeLexicon);
    this.built = { buildings, spaces, index };
    this.warnLexiconGaps(index);
    return index;
  }

  private warnLexiconGaps({ unpinnedFacilities, droppedAliases }: PlaceIndex): void {
    if (unpinnedFacilities.length === 0 && droppedAliases.length === 0) return;
    const ticket = this.gapsThrottle.take([...unpinnedFacilities, ...droppedAliases].join("|"));
    if (!ticket) return;
    logger.warn(
      { event: "building.place.lexicon_gaps", unpinnedFacilities, droppedAliases, suppressed: ticket.suppressed },
      "Place lexicon gaps: a facility has no pinned slug, or an alias names a place skkumap does not hold",
    );
  }
}
