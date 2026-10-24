import { SUPPORTED_LANGS, type I18n, type SupportedLang } from "./types";

/**
 * WHY: two fallback chains on purpose. `t()` over the keyed table: lang → ko → key, since every entry is
 * authored here in all three, so a miss shows its key. `pick()` over inline text: lang → en → ko, blank
 * as absent, since ops authors `en` far more often than `zh`.
 */
type Translation = Partial<Record<SupportedLang, string>>;
type Translations = Record<string, Translation>;

const translations: Translations = {
  "buslist.hssc.title": {
    ko: "인사캠 셔틀버스",
    en: "HSSC Shuttle Bus",
    zh: "人文校区班车",
  },
  "buslist.hssc.subtitle": {
    ko: "정차소(인문.농구장) ↔ 600주년 기념관",
    en: "Bus Stop (Humanities) ↔ 600th Anniversary Hall",
    zh: "停车场(人文.篮球场) ↔ 600周年纪念馆",
  },
  "buslist.inja.title": {
    ko: "인자셔틀",
    en: "INJA Shuttle",
    zh: "仁自班车",
  },
  "buslist.inja.subtitle": {
    ko: "인사캠 ↔ 자과캠",
    en: "HSSC ↔ NSC",
    zh: "人文校区 ↔ 自然校区",
  },
  "buslist.jongro02.title": {
    ko: "종로 02",
    en: "Jongro 02",
    zh: "钟路 02",
  },
  "buslist.jongro02.subtitle": {
    ko: "성균관대학교 ↔ 종각역.YMCA",
    en: "SKKU ↔ Jonggak Stn. YMCA",
    zh: "成均馆大学 ↔ 钟阁站YMCA",
  },
  "buslist.jongro07.title": {
    ko: "종로 07",
    en: "Jongro 07",
    zh: "钟路 07",
  },
  "buslist.jongro07.subtitle": {
    ko: "성균관대운동장 ↔ 600주년기념관",
    en: "SKKU Sports Ground ↔ 600th Anniversary Hall",
    zh: "成均馆大学运动场 ↔ 600周年纪念馆",
  },
  "buslist.jongro08.title": {
    ko: "종로 08",
    en: "Jongro 08",
    zh: "钟路 08",
  },
  "buslist.jongro08.subtitle": {
    ko: "명륜3가 ↔ 종로5가",
    en: "Myeongnyun 3-ga ↔ Jongno 5-ga",
    zh: "明伦3街 ↔ 钟路5街",
  },
  "buslist.fasttrack.subtitle": {
    ko: "테스트 버스",
    en: "Test Bus",
    zh: "测试巴士",
  },
  "buslist.commute.subtitle": {
    ko: "역 ↔ 자과캠 시범 운행",
    en: "Stations ↔ NSC pilot",
    zh: "地铁站 ↔ 自然校区 试运行",
  },
  "buslist.hssc.busTypeText": {
    ko: "성대",
    en: "SKKU",
    zh: "成大",
  },
  "buslist.village.busTypeText": {
    ko: "마을",
    en: "Village",
    zh: "村庄",
  },

  "busconfig.label.hssc": {
    ko: "인사캠 셔틀버스",
    en: "HSSC Shuttle Bus",
    zh: "人文校区班车",
  },
  "busconfig.label.campus": {
    ko: "인자셔틀",
    en: "INJA Shuttle",
    zh: "仁自班车",
  },
  "busconfig.label.jongro02": {
    ko: "종로 02",
    en: "Jongro 02",
    zh: "钟路 02",
  },
  "busconfig.label.jongro07": {
    ko: "종로 07",
    en: "Jongro 07",
    zh: "钟路 07",
  },
  "busconfig.label.jongro08": {
    ko: "종로 08",
    en: "Jongro 08",
    zh: "钟路 08",
  },
  "busconfig.label.gyeonggi7800": { ko: "7800", en: "7800", zh: "7800" },
  "busconfig.label.fasttrack": {
    ko: "패스트트랙",
    en: "Fasttrack",
    zh: "快速通道",
  },
  "busconfig.label.commute": {
    ko: "자과캠 통학 셔틀버스",
    en: "NSC Commuter Shuttle Bus",
    zh: "自然校区通学班车",
  },

  "busconfig.service.campus-inja": {
    ko: "인사캠 → 자과캠",
    en: "HSSC → NSC",
    zh: "人文校区 → 自然校区",
  },
  "busconfig.service.campus-jain": {
    ko: "자과캠 → 인사캠",
    en: "NSC → HSSC",
    zh: "自然校区 → 人文校区",
  },
  // QUIRK(skkuverse-app): commute route labels stay at five Korean characters or fewer: builds
  // without the chips selector render them as a five-way segmented control.
  "busconfig.service.commute-jeongja": {
    ko: "정자",
    en: "Jeongja",
    zh: "亭子",
  },
  "busconfig.service.commute-jamsil": {
    ko: "잠실",
    en: "Jamsil",
    zh: "蚕室",
  },
  "busconfig.service.commute-dogok": {
    ko: "도곡",
    en: "Dogok",
    zh: "道谷",
  },
  "busconfig.service.commute-gangnam-yangjae": {
    ko: "강남·양재",
    en: "Gangnam·Yangjae",
    zh: "江南·良才",
  },
  "busconfig.service.commute-gwanggyo": {
    ko: "광교중앙",
    en: "Gwanggyo Jungang",
    zh: "光教中央",
  },

  "busconfig.badge.regular": {
    ko: "일반",
    en: "Regular",
    zh: "一般",
  },
  "busconfig.badge.hakbu": {
    ko: "학부대학",
    en: "Undergraduate",
    zh: "本科学院",
  },
  "busconfig.badge.fasttrack": {
    ko: "패스트트랙",
    en: "Fasttrack",
    zh: "快速通道",
  },
  "busconfig.badge.up": {
    ko: "등교",
    en: "To campus",
    zh: "上学",
  },
  "busconfig.badge.down": {
    ko: "하교",
    en: "From campus",
    zh: "放学",
  },

  "busconfig.direction.inja": {
    ko: "인사캠 → 자과캠",
    en: "HSSC → NSC",
    zh: "人文校区 → 自然校区",
  },
  "busconfig.direction.jain": {
    ko: "자과캠 → 인사캠",
    en: "NSC → HSSC",
    zh: "自然校区 → 人文校区",
  },
  "busconfig.lineDirection.towards": { ko: "{terminal} 방면", en: "To {terminal}", zh: "{terminal} 方向" },
  "busconfig.lineDirection.fromCampus": { ko: "하교", en: "From campus", zh: "放学" },
  "busconfig.lineDirection.toCampus": { ko: "등교", en: "To campus", zh: "上学" },
  "busconfig.holiday.samil": {
    ko: "삼일절",
    en: "Independence Movement Day",
    zh: "三一节",
  },
  "busconfig.holiday.children": {
    ko: "어린이날",
    en: "Children's Day",
    zh: "儿童节",
  },
  "busconfig.routeType.hakbu": {
    ko: "학부대학",
    en: "Undergraduate",
    zh: "本科学院",
  },
  "busconfig.routeType.regular": {
    ko: "일반",
    en: "Regular",
    zh: "一般",
  },

  "map.campus.hssc.label": {
    ko: "인사캠",
    en: "HSSC",
    zh: "人文校区",
  },
  "map.campus.nsc.label": {
    ko: "자과캠",
    en: "NSC",
    zh: "自然校区",
  },

  "scroll.hsscMap.title": {
    ko: "인사캠 건물지도",
    en: "HSSC Building Map",
    zh: "人文校区建筑地图",
  },
  "scroll.nscMap.title": {
    ko: "자과캠 건물지도",
    en: "NSC Building Map",
    zh: "自然校区建筑地图",
  },
  "scroll.lostFound.title": {
    ko: "분실물",
    en: "Lost & Found",
    zh: "失物招领",
  },

  "map.building.hssc.law": {
    ko: "법학관",
    en: "Law School",
    zh: "法学馆",
  },
  "map.building.hssc.suseon": {
    ko: "수선관",
    en: "Suseon Hall",
    zh: "修善馆",
  },
  "map.building.hssc.suseon_annex": {
    ko: "수선관 별관",
    en: "Suseon Annex",
    zh: "修善馆别馆",
  },
  "map.building.hssc.toegye": {
    ko: "퇴계인문관",
    en: "Toegye Humanities Hall",
    zh: "退溪人文馆",
  },
  "map.building.hssc.hoam": {
    ko: "호암관",
    en: "Hoam Hall",
    zh: "湖岩馆",
  },
  "map.building.hssc.dasan": {
    ko: "다산경제관",
    en: "Dasan Economics Hall",
    zh: "茶山经济馆",
  },
  "map.building.hssc.business": {
    ko: "경영관",
    en: "Business Hall",
    zh: "经营馆",
  },
  "map.building.hssc.faculty": {
    ko: "교수회관",
    en: "Faculty Hall",
    zh: "教授会馆",
  },
  "map.building.hssc.library": {
    ko: "중앙학술정보관",
    en: "Central Library",
    zh: "中央学术信息馆",
  },
  "map.building.hssc.anniversary600": {
    ko: "600주년 기념관",
    en: "600th Anniversary Hall",
    zh: "600周年纪念馆",
  },
  "map.building.hssc.international": {
    ko: "국제관",
    en: "International Hall",
    zh: "国际馆",
  },
  "map.building.hssc.student_union": {
    ko: "학생회관",
    en: "Student Union",
    zh: "学生会馆",
  },

  "map.building.nsc.campus": {
    ko: "자연과학캠퍼스",
    en: "Natural Sciences Campus",
    zh: "自然科学校区",
  },

  "schedule.suspended": {
    ko: "운휴 기간입니다",
    en: "Service is suspended",
    zh: "停运期间",
  },
  "schedule.noData": {
    ko: "시간표 정보를 준비 중입니다",
    en: "Schedule information is being prepared",
    zh: "正在准备时刻表信息",
  },
};

/**
 * WHY: blank counts as absent: `??` would render an ops-typed `en: ""` as an empty caption, a data bug
 * that looks like a rendering one.
 */
function pick(text: I18n | null | undefined, lang: SupportedLang): string | null {
  if (!text) return null;
  for (const candidate of [text[lang], text.en, text.ko]) {
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate;
  }
  return null;
}

/** WHY: not `pick(text, "ko") != null`, which tries [ko, en, ko] and so cannot see a zh-only value. */
function hasAnyText(text: I18n | null | undefined): boolean {
  if (!text) return false;
  return SUPPORTED_LANGS.some((lang) => {
    const value = text[lang];
    return typeof value === "string" && value.trim() !== "";
  });
}

function t(key: string, lang: SupportedLang): string {
  const entry = translations[key];
  if (!entry) return key;
  return entry[lang] || entry.ko || key;
}

export { hasAnyText, pick, t };
