import { linkActionType, type LinkActionType } from "../../shared/link-action.wire";
import { PushContentPolicy, type DraftCheck, type NotificationDraft, type PerimeterDeps } from "../perimeter.ports";
import { announceLocalDev } from "./local-dev-banner";

type Link = { actionType?: LinkActionType; actionValue?: string };

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function toLink({ actionType, actionValue }: NotificationDraft): Link | null {
  if (actionType == null) return {};
  const type = linkActionType.safeParse(actionType);
  const value = text(actionValue);
  return type.success && value ? { actionType: type.data, actionValue: value } : null;
}

// WHY: the shape a stored notification needs and nothing more: texts present, a link with a known action type.
export class LocalDevPushContentPolicy extends PushContentPolicy {
  constructor(deps: PerimeterDeps) {
    super();
    announceLocalDev(deps, "pushContentPolicy");
  }

  check(draft: NotificationDraft): Promise<DraftCheck> {
    const title_ko = text(draft.title_ko);
    const body_ko = text(draft.body_ko);
    const link = toLink(draft);
    if (!title_ko || !body_ko || !link) {
      return Promise.resolve({ problems: ["title_ko and body_ko are required; actionType needs a known type and an actionValue"] });
    }
    return Promise.resolve({ content: { title_ko, body_ko, title_en: text(draft.title_en), body_en: text(draft.body_en), ...link } });
  }
}
