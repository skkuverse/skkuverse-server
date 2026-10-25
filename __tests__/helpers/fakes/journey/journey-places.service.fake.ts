/**
 * Scripted JourneyPlacesService: `findPlace` answers a place for every ref of `<kind>:<id>` form, named
 * `<id> (<lang>)` at fixed coords with the platform asked for, except a ref in `unresolved`, which answers null as a
 * catalog that no longer holds it would.
 */
import type { SupportedLang } from "../../../../src/infra/types";
import type { JourneyPlacesService } from "../../../../src/journey/places/journey-places.service";
import type { Place } from "../../../../src/shared/place.wire";
import type { PublicOf } from "../public-of";

export class FakeJourneyPlacesService implements PublicOf<JourneyPlacesService> {
  unresolved = new Set<string>();

  async findPlace(ref: string, platformId: string | null, lang: SupportedLang): Promise<Place | null> {
    const [kind, id] = ref.split(":");
    if (this.unresolved.has(ref) || !kind || !id) return null;
    return { kind: kind as Place["kind"], id, name: `${id} (${lang})`, coords: { lat: 37.5, lng: 127 }, platformId, action: null };
  }
}
