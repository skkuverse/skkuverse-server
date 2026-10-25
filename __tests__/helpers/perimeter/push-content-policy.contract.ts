/**
 * PUSH_CONTENT_POLICY (ADR 0023, D7): a draft without its Korean texts is refused with the problems the 400
 * names, and a stored notification carries the texts it was sent with, never more.
 */
import type { PerimeterDeps, PushContentPolicy, PushContentScope } from "../../../src/perimeter/perimeter.ports";
import { itConstructsLikeThePoller, perimeterTestDeps } from "./perimeter-deps";

const SCOPE: PushContentScope = { senderId: "mukja", gameIds: [], isKnownMiniAppTarget: () => false };

export function describePushContentPolicyContract(make: (deps: PerimeterDeps) => PushContentPolicy): void {
  describe("the PUSH_CONTENT_POLICY contract", () => {
    itConstructsLikeThePoller(make);

    it("refuses a draft without its Korean title and body, naming problems", async () => {
      // Act
      const checked = await make(perimeterTestDeps()).check({}, SCOPE);

      // Assert
      expect("problems" in checked && checked.problems.length > 0).toBe(true);
    });

    it("keeps the Korean texts of a plain draft, with no link", async () => {
      // Act
      const checked = await make(perimeterTestDeps()).check({ title_ko: "학식", body_ko: "오늘 메뉴" }, SCOPE);

      // Assert
      expect(checked).toEqual({ content: { title_ko: "학식", body_ko: "오늘 메뉴", title_en: null, body_en: null } });
    });
  });
}
