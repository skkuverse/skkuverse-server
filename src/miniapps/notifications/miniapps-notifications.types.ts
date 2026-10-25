import type { LinkActionType } from "../../shared/link-action.wire";
import type { SendOutcome } from "./miniapps-notifications.wire";

/** WHY: every `miniapps.notify.*` line names the sender and the key that signed, never the signature. */
export interface SendTrace {
  miniAppId: string;
  keyId: string | null;
  notificationId: string;
  title: string;
  actionType?: LinkActionType;
  actionValue?: string;
  hasEn: boolean;
}

/** WHY: what a send answers its route: the draft's problems (400), a spent quota (429), or the outcome. */
export type SendResult = { problems: string[] } | { retryAfterSeconds: number } | SendOutcome;
