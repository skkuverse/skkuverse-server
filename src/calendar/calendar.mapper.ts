// QUIRK(skku): a rest day that still counts as part of a class day carries it in its title, `공부자탄강일(수업일수 1/4)`
// in 2025; riders are shown the name alone.
const CLASS_DAY_COUNT = /\s*\(수업일수[^)]*\)/g;

export function toSchoolRestDayLabel(title: string): string {
  return title.replace(CLASS_DAY_COUNT, "").trim();
}
