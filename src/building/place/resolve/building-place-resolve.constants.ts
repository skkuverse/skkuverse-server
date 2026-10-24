export const LINK_PATTERN =
  /https?:\/\/\S+|www\.\S+|[\p{L}\p{N}_.+-]+@[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)+|\b[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*\.(?:com|net|org|io|kr|edu)\b\S*/giu;

// QUIRK(skku): a printed room code is a spaceCd as is (`9B217`, `33B101`, `21101A`, `480209`), never a phone or a date.
export const ROOM_CODE_PATTERN = /(?<![0-9A-Za-z\-./:@])([0-9]{1,3}B?[0-9]{2,6}[A-Za-z]?)(?![0-9A-Za-z])/g;

export const MIN_ROOM_CODE_LENGTH = 5;

export const ROOM_NUMBER_PATTERN = /(?<![0-9A-Za-z-])(B?\d{3,4}[A-Z]?)\s*호|\broom\s*(?:no\.?\s*)?(B?\d{3,4}[A-Z]?)\b/giu;

// QUIRK(skku): the natural sciences campus numbers its buildings `NN동`, which is buildNo `2NN`.
export const NSC_BUILDING_NUMBER_PATTERN = /(?<![\d-])(\d{2})\s*동(?![가-힣])/g;

export const NSC_BUILDING_DIGIT = "2";

// WHY: read in this order, each match blanked, so `지하1층` is B1 and never also floor 1.
export const FLOOR_PATTERNS: ReadonlyArray<{ pattern: RegExp; basement: boolean }> = [
  { pattern: /지하\s*(\d)\s*층/g, basement: true },
  { pattern: /(?<![0-9A-Za-z])B\s?(\d)(?:\s*(?:F|층|floor))?(?![0-9A-Za-z])/gi, basement: true },
  { pattern: /(?<![0-9])(\d{1,2})\s*층/g, basement: false },
  { pattern: /(?<![0-9A-Za-z])(\d{1,2})\s*F(?![A-Za-z0-9])/g, basement: false },
  { pattern: /(\d{1,2})(?:st|nd|rd|th)\s*floor/gi, basement: false },
];

export const SKKU_NAME_PATTERN = /성균관대학교|성균관대/g;
