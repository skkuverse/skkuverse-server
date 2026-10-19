import type { MiniappsService } from "../../miniapps/miniapps.service";

export type LogoResolver = MiniappsService["resolveLogo"];

export interface HomeLayoutIssue {
  path: Array<string | number>;
  message: string;
}
