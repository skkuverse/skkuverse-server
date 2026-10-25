import type { DraftCheck, NotificationContent, NotificationDraft, PushContentPolicy, PushContentScope } from "../../../../src/perimeter/perimeter.ports";
import type { LinkActionType } from "../../../../src/shared/link-action.wire";
import type { PublicOf } from "../public-of";

const asSent = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** The draft's fields as sent, unchecked: the texts, the English pair when strings, the link when both are strings. */
function passedThrough(draft: NotificationDraft): NotificationContent {
  const link = typeof draft.actionType === "string" && typeof draft.actionValue === "string" ? { actionType: draft.actionType as LinkActionType, actionValue: draft.actionValue } : {};
  return { title_ko: String(draft.title_ko), body_ko: String(draft.body_ko), title_en: asSent(draft.title_en), body_en: asSent(draft.body_en), ...link };
}

/** Answers every draft with `result` once a test sets it, else passes the draft through as sent; keeps the calls. */
export class FakePushContentPolicy implements PublicOf<PushContentPolicy> {
  result: DraftCheck | undefined;
  readonly calls: Array<{ draft: NotificationDraft; scope: PushContentScope }> = [];

  check(draft: NotificationDraft, scope: PushContentScope): Promise<DraftCheck> {
    this.calls.push({ draft, scope });
    return Promise.resolve(this.result ?? { content: passedThrough(draft) });
  }
}
