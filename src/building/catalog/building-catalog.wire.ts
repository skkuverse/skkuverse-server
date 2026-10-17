import { z } from "zod";
import { bilingualText, buildingCard } from "../building.wire";

const floorGroup = z.object({
  floor: bilingualText,
  spaces: z.array(
    z.object({
      /** QUIRK(skku): a stored space can have no code (SpaceDoc); it is served as stored. */
      spaceCd: z.string().nullable(),
      name: bilingualText,
      conspaceCd: z.string().nullable().optional(),
    }),
  ),
});

/** WHY: read from the requested building, `fromFloor` (its own) to `toFloor` (the target's). */
const buildingConnection = z.object({
  targetSkkuId: z.int(),
  targetBuildNo: z.string().nullable(),
  targetDisplayNo: z.string().nullable(),
  targetName: bilingualText,
  fromFloor: bilingualText,
  toFloor: bilingualText,
});

const buildingCafeteria = z.object({
  /** CONTRACT(skkuverse-crawler): SKKU's conspaceCd, the cafeteria id skkuverse-crawler/py/src/skkuverse_crawler/modules/meals/models.py stores. */
  id: z.string(),
  name: bilingualText,
  /** WHY: the Korean floor name, the key `floors[].floor.ko` groups by; null when SKKU gives none. */
  floor: z.string().nullable(),
  spaceCd: z.string().nullable(),
});

export const buildingList = z.object({
  buildings: z.array(buildingCard),
});

export const buildingDetail = z.object({
  building: buildingCard,
  floors: z.array(floorGroup),
  connections: z.array(buildingConnection),
  cafeterias: z.array(buildingCafeteria),
});

export type BuildingList = z.input<typeof buildingList>;
export type BuildingDetail = z.input<typeof buildingDetail>;
