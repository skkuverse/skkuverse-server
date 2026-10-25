import type { LinkActionType } from "../../shared/link-action.wire";

export interface SendTrace {
  miniAppId: string;
  notificationId: string;
  title: string;
  actionType?: LinkActionType;
  actionValue?: string;
  hasEn: boolean;
}
