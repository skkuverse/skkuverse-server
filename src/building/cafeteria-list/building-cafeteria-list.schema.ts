import type { z } from "zod";
import { cafeteriaDoc } from "../building.schema";
import type { ListedCafeteria } from "./building-cafeteria-list.document";

export const listedCafeteria = cafeteriaDoc.pick({
  _id: true,
  campus: true,
  name: true,
  buildNo: true,
  floor: true,
  spaceCd: true,
  location: true,
}) satisfies z.ZodType<ListedCafeteria>;
