/**
 * NoticesTabsService over the committed tab files: Korean for ko, English for en and for zh (no zh labels are
 * built), the same object every time.
 */
import { NoticesTabsService } from "./notices-tabs.service";

describe("NoticesTabsService.listTabs", () => {
  const service = new NoticesTabsService();
  const deptLabel = (lang: "ko" | "en" | "zh"): unknown => service.listTabs(lang).tabs.find((tab) => tab.key === "dept")?.label;

  it("answers ko in Korean and en and zh in English", () => {
    // Act & Assert
    expect([deptLabel("ko"), deptLabel("en"), deptLabel("zh")]).toEqual(["학과", "Department", "Department"]);
  });

  it("serves the response built once at construction", () => {
    // Act & Assert
    expect(service.listTabs("en")).toBe(service.listTabs("zh"));
  });
});
