/**
 * (An agent tooling note is left out of the public history.)
 *
 */
import { placeLabels, skkumapPlaces, type LabelledPlace } from "../../../../__tests__/helpers/building/places";
import type { BuildNo, Campus, SpaceCd } from "../../building.types";
import { placeLexicon } from "../building-place.config";
import { toPlaceIndex } from "../building-place.rules";
import type { PlaceIndex, ResolvedPlace } from "../building-place.types";
import { resolvePlace } from "./building-place-resolve.rules";
import type { CampusHint } from "./building-place-resolve.types";

const space = (campus: Campus, spaceCd: string, buildNo: string): ResolvedPlace => ({ kind: "space", campus, spaceCd: spaceCd as SpaceCd, buildNo: buildNo as BuildNo });
const building = (campus: Campus, buildNo: string): ResolvedPlace => ({ kind: "building", campus, buildNo: buildNo as BuildNo });
const facility = (campus: Campus, slug: string): ResolvedPlace => ({ kind: "facility", campus, slug });
const unresolved = (reason: "online" | "offcampus" | "campusOnly" | "unknown", campus: Campus | null = null): ResolvedPlace => ({
  kind: "unresolved",
  reason,
  campus,
});

let index: PlaceIndex;

beforeAll(() => {
  index = toPlaceIndex(skkumapPlaces(), placeLexicon);
});

const resolve = (text: string, campusHint: CampusHint = null, source: string | null = null) =>
  resolvePlace({ text, campusHint, source }, index);

/** The buildNo a labelled or resolved place stands in, so a room in the right building counts at building level. */
function buildNoOf(place: { kind: string; campus?: Campus; spaceCd?: string; buildNo?: string }): string | null {
  if (place.kind === "building") return place.buildNo ?? null;
  if (place.kind !== "space") return null;
  const spaces = index.spacesByCd.get(String(place.spaceCd).toUpperCase()) ?? [];
  return spaces.find((s) => s.campus === place.campus)?.buildNo ?? null;
}

type Verdict = "exact room" | "same building" | "same facility" | "wrong place" | "wrong pin" | "missed" | "both unpinned";

function judge(expected: LabelledPlace, got: ResolvedPlace): Verdict {
  const isPinned = got.kind !== "unresolved";
  if (expected.kind === "none") return isPinned ? "wrong pin" : "both unpinned";
  if (!isPinned) return "missed";
  if (expected.kind === "space" && got.kind === "space" && expected.campus === got.campus && expected.spaceCd === got.spaceCd) return "exact room";
  if (expected.kind === "facility" || got.kind === "facility") {
    return expected.kind === "facility" && got.kind === "facility" && expected.slug === got.slug && expected.campus === got.campus ? "same facility" : "wrong place";
  }
  const isSameBuilding = expected.campus === got.campus && buildNoOf(expected) !== null && buildNoOf(expected) === buildNoOf(got);
  return isSameBuilding ? "same building" : "wrong place";
}

describe("resolvePlace over the labelled second-term strings", () => {
  const PROTOTYPE_BLIND_RECALL = 82;
  const PROTOTYPE_EXACT_ROOMS = 50;

  it("never pins a place the label does not name, and keeps at least the prototype's recall", () => {
    // Arrange
    const labels = placeLabels();

    // Act
    const verdicts = labels.map((label) => ({ label, verdict: judge(label.expected, resolve(label.place, label.campusHint, label.source)) }));

    // Assert
    const wrong = verdicts.filter((v) => v.verdict === "wrong place" || v.verdict === "wrong pin").map((v) => v.label.place);
    const right = verdicts.filter((v) => ["exact room", "same building", "same facility"].includes(v.verdict)).length;
    const pinnable = labels.filter((l) => l.expected.kind !== "none").length;
    expect(labels).toHaveLength(220);
    expect(pinnable).toBe(84);
    expect(wrong).toEqual([]);
    expect(right).toBeGreaterThanOrEqual(PROTOTYPE_BLIND_RECALL);
    expect(verdicts.filter((v) => v.verdict === "exact room").length).toBeGreaterThanOrEqual(PROTOTYPE_EXACT_ROOMS);
  });
});

describe("resolvePlace", () => {
  it.each([
    ["국제관 9B217 강의실", "hssc", "skku-main", space("hssc", "9B217", "109")],
    ["제2공학관 3층 27301호", null, null, space("nsc", "27301", "227")],
    ["N센터(수원시 장안구 서부로 2066) 1층 86133호 MRI 연구실", null, null, space("nsc", "86133", "286")],
    ["자연과학캠퍼스 제1공학관 21동 21101A호", null, null, space("nsc", "21101A", "221")],
    ["85602, Natural Sciences Campus (Suwon), SKKU", null, null, space("nsc", "85602", "285")],
    ["삼성학술정보관 480209호", null, null, space("nsc", "480209", "248")],
  ] as const)("reads the printed room code in %j", (text, hint, source, expected) => {
    // Act & Assert
    expect(resolve(text, hint, source)).toEqual(expected);
  });

  it.each([
    ["33B101", "hssc", null, space("hssc", "33B101", "133")],
    ["33B101", "nsc", null, space("nsc", "33B101", "233")],
    ["33B101", null, "dorm-nsc", space("nsc", "33B101", "233")],
    ["33B101", null, "lib-hssc", space("hssc", "33B101", "133")],
    ["경영관 33B101", "nsc", null, space("hssc", "33B101", "133")],
    ["31317", "nsc", null, space("nsc", "31317", "231")],
    ["퇴계인문관 31317", "nsc", null, space("hssc", "31317", "131")],
    ["Natural Sciences 1, 31317", null, null, space("nsc", "31317", "231")],
    ["33B101", null, null, unresolved("unknown")],
    ["33B101", "both", null, unresolved("unknown")],
    ["자연과학캠퍼스 9B217", "hssc", null, unresolved("unknown")],
  ] as const)("settles a code on both campuses by building, then text, hint and board: %j hint %j board %j", (text, hint, source, expected) => {
    // Act & Assert
    expect(resolve(text, hint, source)).toEqual(expected);
  });

  it.each([
    ["퇴계인문관 403호", space("hssc", "31403", "131")],
    ["호암관 412호", space("hssc", "50412", "105")],
    ["경영관 101호", space("hssc", "33101", "133")],
    ["삼성학술정보관 지하1층 오디토리움", space("nsc", "48B108", "248")],
    ["국제관 1층 학생 라운지", space("hssc", "90101", "109")],
    ["600주년기념관 2층 대학원팀", space("hssc", "10206", "101")],
    ["600주년기념관 5층 조병두 국제홀", space("hssc", "10501", "101")],
    ["학생회관 1층 소강당", space("nsc", "03108", "203")],
    ["국제관 지하1층 중국대학원 라운지", space("hssc", "9B106", "109")],
    ["교무팀 창구", space("hssc", "10111", "101")],
    ["학생성공센터행정실(인문사회과학캠퍼스)", space("hssc", "90102", "109")],
  ])("composes a room inside the named building, or finds an office, in %j", (text, expected) => {
    // Act & Assert
    expect(resolve(text)).toEqual(expected);
  });

  it.each([
    ["N센터", null, building("nsc", "286")],
    ["삼성학술정보관 4F", null, building("nsc", "248")],
    ["수선관", null, building("hssc", "161")],
    ["수선관 별관", null, building("hssc", "162")],
    ["In front of Ji-kwan", null, building("nsc", "295")],
    ["In front of Ji-kwan", "hssc", building("nsc", "295")],
    ["인사캠 학생회관", null, building("hssc", "108")],
    ["학생회관 2층", "nsc", building("nsc", "203")],
    ["학생회관 2층", null, unresolved("unknown")],
    ["제2공학관", null, unresolved("unknown", "nsc")],
    ["공자로 차없는거리", null, facility("nsc", "confucius-road")],
    ["금잔디광장", null, facility("hssc", "geumjandi-square")],
    ["대운동장", "nsc", facility("nsc", "large-playground")],
    ["대운동장", null, unresolved("unknown")],
    ["성균관대학교 자연과학캠퍼스 야구장", null, facility("nsc", "baseball-field")],
  ] as const)("pins a building or facility by name: %j hint %j", (text, hint, expected) => {
    // Act & Assert
    expect(resolve(text, hint)).toEqual(expected);
  });

  it.each([
    ["Between Ui-kwan and Ye-kwan", "dorm-nsc", facility("nsc", "ui-ye-kwan-yard")],
    ["의관 예관 사이", null, facility("nsc", "ui-ye-kwan-yard")],
    ["제2공학관 중앙정원", null, facility("nsc", "engineering-2-courtyard")],
    ["명륜학사", null, facility("hssc", "myeongnyun-dormitory")],
    ["경영관 LVS", null, space("hssc", "33203", "133")],
    ["국제관 R&E 라운지(국제관 5층)", null, space("hssc", "90502", "109")],
    ["시네마룸", "lib-nsc", space("nsc", "480211", "248")],
    ["시네마룸", null, unresolved("unknown")],
    ["온라인", "lib-nsc", unresolved("online")],
  ] as const)("knows the owner-approved additions: %j board %j", (text, source, expected) => {
    // Act & Assert
    expect(resolve(text, null, source)).toEqual(expected);
  });

  it.each([
    ["서울성모병원 의생명산업연구원 2층 대강당", null, unresolved("offcampus")],
    ["고려대학교 경영관", null, unresolved("offcampus")],
    ["코엑스(강남) 컨퍼런스룸 3F 328호", null, unresolved("offcampus")],
    ["탑골공원", "hssc", unresolved("offcampus")],
    ["https://zoom.example/j/0", null, unresolved("online")],
    ["Zoom", "hssc", unresolved("online")],
    ["person@example.com", "hssc", unresolved("online")],
    ["본교 홈페이지 인터넷 접수", null, unresolved("online")],
    ["인사캠", null, unresolved("campusOnly", "hssc")],
    ["자과캠", "hssc", unresolved("campusOnly", "nsc")],
    ["성균관대학교 인문과학캠퍼스 (서울특별시 종로구 소재)", null, unresolved("campusOnly", "hssc")],
    ["성균관대학교 자연과학캠퍼스 기숙사행정실", null, unresolved("campusOnly", "nsc")],
    ["성균관대학교", null, unresolved("unknown")],
    ["학과 사무실", "hssc", unresolved("unknown")],
    ["추후 공지", null, unresolved("unknown")],
    ["", null, unresolved("unknown")],
  ] as const)("leaves %j unpinned with its reason", (text, hint, expected) => {
    // Act & Assert
    expect(resolve(text, hint)).toEqual(expected);
  });

  it("takes a campus-wide area's campus from the board when the text names none", () => {
    // Act & Assert
    expect(resolve("기숙사", null, "dorm-nsc")).toEqual(unresolved("campusOnly", "nsc"));
    expect(resolve("신관 식당", null, "dorm-nsc")).toEqual(space("nsc", "298B1062", "298"));
  });

  it("lets no hint move a code or name the text already decides", () => {
    // Act & Assert
    expect(resolve("국제관 9B217호", "nsc")).toEqual(space("hssc", "9B217", "109"));
    expect(resolve("경영관 33B101", "nsc", "dorm-nsc")).toEqual(space("hssc", "33B101", "133"));
  });
});
