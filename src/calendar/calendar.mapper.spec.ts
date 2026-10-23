/**
 * The label a crawled school rest day is shown with: SKKU's own title, less a
 * parenthetical that counts class days (2025's `공부자탄강일(수업일수 1/4)`),
 * which riders have no use for; any other parenthetical stays.
 */
import { toSchoolRestDayLabel } from "./calendar.mapper";

describe("toSchoolRestDayLabel", () => {
  it.each([
    ["공부자탄강일(수업일수 1/4)", "공부자탄강일"],
    ["공부자탄강일 (수업일수 1/4)", "공부자탄강일"],
    ["건학기념일 · 공부자탄강일(수업일수 1/4)", "건학기념일 · 공부자탄강일"],
    ["공부자탄강일(수업일수 1/4) · 건학기념일", "공부자탄강일 · 건학기념일"],
    ["건학기념일", "건학기념일"],
    ["개교기념일(대학원)", "개교기념일(대학원)"],
  ])("%s is shown as %s", (title, label) => {
    // Act & Assert
    expect(toSchoolRestDayLabel(title)).toBe(label);
  });
});
