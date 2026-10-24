import { z } from "zod";

export const campus = z.enum(["hssc", "nsc"]);

export type Campus = z.input<typeof campus>;
