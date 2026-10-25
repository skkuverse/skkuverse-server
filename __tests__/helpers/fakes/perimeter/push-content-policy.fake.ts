import type { DraftCheck, NotificationDraft, PushContentPolicy, PushContentScope } from "../../../../src/perimeter/perimeter.ports";
import type { PublicOf } from "../public-of";

/** Answers every draft with `result` once a test sets it, else keeps its two Korean texts as sent; keeps the calls. */
export class FakePushContentPolicy implements PublicOf<PushContentPolicy> {
  result: DraftCheck | undefined;
  readonly calls: Array<{ draft: NotificationDraft; scope: PushContentScope }> = [];

  check(draft: NotificationDraft, scope: PushContentScope): Promise<DraftCheck> {
    this.calls.push({ draft, scope });
    const passedThrough = { content: { title_ko: String(draft.title_ko), body_ko: String(draft.body_ko), title_en: null, body_en: null } };
    return Promise.resolve(this.result ?? passedThrough);
  }
}
