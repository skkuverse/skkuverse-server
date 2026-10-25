import { z } from "zod";

export const latLng = z.object({ lat: z.number(), lng: z.number() });
