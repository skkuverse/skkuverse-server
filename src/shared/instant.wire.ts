import { z } from "zod";

/** WHY: an instant at +09:00 to the second, as toKstInstant formats every one served (ADR 0019, D1; ADR 0022, D2). */
export const instant = z.iso.datetime({ offset: true });
