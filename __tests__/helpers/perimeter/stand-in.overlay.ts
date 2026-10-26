/**
 * The overlay entry a checkout without the overlay answers overlay-mode cases from (ADR 0023, D4): `jest.config.js`
 * maps OVERLAY_ENTRY here only while src/private/perimeter.overlay.ts is absent, so the composed gate runs the same
 * cases against the real entry. It holds no policy: one empty subclass of each LocalDev class, so a case that expects
 * the entry's own classes cannot pass on the LocalDev ones, and a settings check that accepts any sections.
 */
import { LocalDevAbuseSignals } from "../../../src/perimeter/local-dev/abuse-signals";
import { LocalDevInternalAuthorizer } from "../../../src/perimeter/local-dev/internal-authorizer";
import { LocalDevMiniAppPushAuthorizer } from "../../../src/perimeter/local-dev/mini-app-push-authorizer";
import { LocalDevMiniAppPushQuota } from "../../../src/perimeter/local-dev/mini-app-push-quota";
import { LocalDevOriginTrust } from "../../../src/perimeter/local-dev/origin-trust";
import { LocalDevOutboundPolicy } from "../../../src/perimeter/local-dev/outbound-policy";
import { LocalDevPushContentPolicy } from "../../../src/perimeter/local-dev/push-content-policy";
import { LocalDevRateLimitPolicy } from "../../../src/perimeter/local-dev/rate-limit-policy";
import { LocalDevRequestAuthenticator } from "../../../src/perimeter/local-dev/request-authenticator";
import { PERIMETER_PORTS_VERSION, type PerimeterClasses } from "../../../src/perimeter/perimeter.ports";

export const portsVersion = PERIMETER_PORTS_VERSION;

export const classes: PerimeterClasses = {
  requestAuthenticator: class extends LocalDevRequestAuthenticator {},
  rateLimitPolicy: class extends LocalDevRateLimitPolicy {},
  internalAuthorizer: class extends LocalDevInternalAuthorizer {},
  miniAppPushAuthorizer: class extends LocalDevMiniAppPushAuthorizer {},
  miniAppPushQuota: class extends LocalDevMiniAppPushQuota {},
  pushContentPolicy: class extends LocalDevPushContentPolicy {},
  originTrust: class extends LocalDevOriginTrust {},
  outboundPolicy: class extends LocalDevOutboundPolicy {},
  abuseSignals: class extends LocalDevAbuseSignals {},
};

export const settingsErrors = (_sections: Readonly<Record<string, string>>): string[] => [];
