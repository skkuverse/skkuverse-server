import { z } from "zod";

export const linkActionType = z.enum(["miniapp", "external", "webview", "route"]);

export type LinkActionType = z.input<typeof linkActionType>;
