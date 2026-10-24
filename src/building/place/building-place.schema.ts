import { z } from "zod";
import { CAMPUSES } from "../building.constants";
import { storedSpace } from "../building.schema";
import type { PlaceSpace } from "./building-place.document";

const campus = z.enum(CAMPUSES);

const phrases = z.array(z.string().min(1));

const buildingAlias = z.strictObject({
  alias: z.string().min(2),
  targets: z.array(z.string().min(1)).min(1),
  weak: z.boolean().optional(),
  boundary: z.boolean().optional(),
});

const roomAlias = z.strictObject({ alias: z.string().min(2), spaceCd: z.string().min(1), campus });

const extraFacility = z.strictObject({
  campus,
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.strictObject({ ko: z.string().min(1), en: z.string().min(1) }),
  aliases: phrases,
});

export const placeLexiconFile = z.strictObject({
  buildingAliases: z.array(buildingAlias),
  weakNames: phrases,
  notAliases: phrases,
  roomAliases: z.array(roomAlias),
  facilitySlugs: z.record(z.string().regex(/^\d+$/), z.string().regex(/^[a-z0-9-]+$/)),
  extraFacilities: z.array(extraFacility),
  campusAreas: z.array(z.strictObject({ alias: z.string().min(2), campus: campus.nullable() })),
  campusPhrases: z.strictObject({ hssc: phrases, nsc: phrases }),
  skkuMarkers: phrases,
  boardCampus: z.record(z.string(), campus),
  boardBuilding: z.record(z.string(), z.string().regex(/^\d+$/)),
  online: phrases,
  offcampusStrong: phrases,
  offcampusPlace: phrases,
  offcampusWeak: phrases,
  notPlace: phrases,
  officeSuffix: z.string().min(1),
  officeMaxBuildings: z.number().int().positive(),
  genericOffices: phrases,
});

export type PlaceLexicon = z.output<typeof placeLexiconFile>;

export const placeSpace = storedSpace.pick({
  spaceCd: true,
  buildNo: true,
  campus: true,
  floor: true,
  name: true,
  buildingName: true,
}) satisfies z.ZodType<PlaceSpace>;
