import { Injectable } from "@nestjs/common";
import { responseByLang } from "./tabConfig";

/**
 * TabConfigService — the injectable face of ./tabConfig.ts for
 * NoticesController (and for tests that override it).
 *
 * Loading and validation live only in ./tabConfig.ts, and run when this file is
 * first imported: a bad categories.json, sources.json or exclude-reasons.json
 * logs `notices.tabconfig.invalid` and exits the process before Nest bootstraps.
 */
@Injectable()
export class TabConfigService {
  /**
   * Validated, frozen tabs response keyed by language ("ko" | "en").
   * zh falls back to "en" at the controller.
   */
  readonly responseByLang = responseByLang;
}
