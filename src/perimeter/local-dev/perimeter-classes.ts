import type { PerimeterClasses } from "../perimeter.ports";
import { LocalDevAbuseSignals } from "./abuse-signals";
import { LocalDevInternalAuthorizer } from "./internal-authorizer";
import { LocalDevMiniAppPushAuthorizer } from "./mini-app-push-authorizer";
import { LocalDevMiniAppPushQuota } from "./mini-app-push-quota";
import { LocalDevOriginTrust } from "./origin-trust";
import { LocalDevOutboundPolicy } from "./outbound-policy";
import { LocalDevPushContentPolicy } from "./push-content-policy";
import { LocalDevRateLimitPolicy } from "./rate-limit-policy";
import { LocalDevRequestAuthenticator } from "./request-authenticator";

export const LOCAL_DEV_CLASSES: PerimeterClasses = {
  requestAuthenticator: LocalDevRequestAuthenticator,
  rateLimitPolicy: LocalDevRateLimitPolicy,
  internalAuthorizer: LocalDevInternalAuthorizer,
  miniAppPushAuthorizer: LocalDevMiniAppPushAuthorizer,
  miniAppPushQuota: LocalDevMiniAppPushQuota,
  pushContentPolicy: LocalDevPushContentPolicy,
  originTrust: LocalDevOriginTrust,
  outboundPolicy: LocalDevOutboundPolicy,
  abuseSignals: LocalDevAbuseSignals,
};
