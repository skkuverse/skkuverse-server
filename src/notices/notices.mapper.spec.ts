/**
 * The text normalization the list and detail mappers share: an empty or missing text is served as null, any
 * other text as it is.
 *
 * The same file holds what the row and the screen share of a fact's quote: the words a table label puts before it
 * (codebook v3.11), left out when the label is empty or the quote already says it, and the mark a draw's text always
 * carries.
 */
import { textOrNull, toBenefitText, toQuoteText } from "./notices.mapper";

describe("textOrNull", () => {
  it.each([
    ["", null],
    [null, null],
    [undefined, null],
    [" ", " "],
    ["학부통합(학사)", "학부통합(학사)"],
  ])("%j → %j", (value, expected) => {
    // Act & Assert
    expect(textOrNull(value)).toBe(expected);
  });
});

describe("toQuoteText", () => {
  it.each<[string, { quote: string; label?: string }, string]>([
    ["puts the label before the quote", { quote: "3,000,000원", label: "장학금" }, "장학금 · 3,000,000원"],
    ["shows the quote alone when there is no label", { quote: "3,000,000원" }, "3,000,000원"],
    ["shows the quote alone when the label is empty", { quote: "3,000,000원", label: "" }, "3,000,000원"],
    ["shows the quote alone when the label is only spaces", { quote: "3,000,000원", label: " \n " }, "3,000,000원"],
    ["shows the quote alone when it already says the label", { quote: "장학금 3,000,000원", label: "장학금" }, "장학금 3,000,000원"],
    ["compares the two without their spaces", { quote: "지원 자격: 재학생", label: "지원자격" }, "지원 자격: 재학생"],
    ["compares the two without their line breaks", { quote: "지원\n자격 재학생", label: "지원 자격" }, "지원\n자격 재학생"],
    ["writes a label's line break and padding as one space", { quote: "100명", label: "  모집\n인원 " }, "모집 인원 · 100명"],
    ["keeps the quote's own spacing", { quote: "월\n50만원", label: "혜택" }, "혜택 · 월\n50만원"],
    ["keeps a label that only contains the quote, which says less than the quote", { quote: "재학생", label: "재학생 대상 지원 자격" }, "재학생 대상 지원 자격 · 재학생"],
  ])("%s", (_title, evidence, expected) => {
    // Act & Assert
    expect(toQuoteText(evidence)).toBe(expected);
  });
});

describe("toBenefitText", () => {
  const benefit = (quote: string, isDraw: boolean, label?: string) => ({ isDraw, ev: { quote, ...(label === undefined ? {} : { label }) } });

  it.each([
    ["a benefit that is no draw, as its quote text", benefit("월 50만원", false, "장학금"), "장학금 · 월 50만원"],
    ["a draw, marked after its text", benefit("커피 쿠폰", true), "커피 쿠폰 (추첨)"],
    ["a labelled draw, marked after the label and the quote", benefit("커피 쿠폰", true, "경품"), "경품 · 커피 쿠폰 (추첨)"],
    ["a draw whose quote says so", benefit("추첨을 통해 상품권 지급", true), "추첨을 통해 상품권 지급"],
    ["a draw whose label says so, and the quote does not", benefit("커피 쿠폰", true, "추첨 경품"), "추첨 경품 · 커피 쿠폰"],
    ["a benefit that is no draw but says 추첨", benefit("추첨 결과 발표", false), "추첨 결과 발표"],
  ])("writes %s", (_title, input, expected) => {
    // Act & Assert
    expect(toBenefitText(input)).toBe(expected);
  });
});
