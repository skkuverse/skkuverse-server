import { z } from "zod";
import { STOP_ID_PATTERN } from "../bus.constants";

// WHY: the shape of a stop id; whether a served route stops there is the stop index's.
export const stopIdParam = z.string().regex(STOP_ID_PATTERN, { error: "stopId must be a stop id: lower-case letters and digits in words joined by single hyphens" });
