import { z } from "zod";

export const linkActionType = z.enum(["miniapp", "external", "webview", "route"]);

/** WHY: where a tap goes: a type and its value, as every screen's link carries them. */
export const linkAction = z.object({ actionType: linkActionType, actionValue: z.string() });

export type LinkActionType = z.input<typeof linkActionType>;
export type LinkAction = z.input<typeof linkAction>;
