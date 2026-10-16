/**
 * The schemas SubwaySeoulApiClient reads the Seoul real-time subway API
 * through, checked against the 2026-10-09 and 2026-10-16 captures
 * (__tests__/nest/subway/fixtures/, see each file's `_about`). What it
 * guards: every captured body and row passes; a body or row missing any field
 * of its shape fails at that field's path; the bare status body of a failure
 * passes as a status; a train number is four digits, `trainSttus` is 0 to 3
 * and `recptnDt` a KST date and time. How the client turns a failed parse into
 * an error is subway-seoul-api.client.spec.ts's.
 */
import fs from "fs";
import path from "path";
import { seoulApiStatus, seoulArrivalBody, seoulArrivalRow, seoulPositionBody, seoulPositionRow } from "./subway-seoul-api.schema";

type Payload = Record<string, unknown>;

const fixture = (name: string): Payload =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "../../../__tests__/nest/subway/fixtures", name), "utf8"));
const POSITIONS_LINE_1 = fixture("realtime-position-line1.json");
const POSITIONS_LINE_4 = fixture("realtime-position-line4.json");
const ARRIVALS_HYEHWA = fixture("realtime-arrival-hyehwa.json");
const ARRIVALS_SUNGKYUNKWAN = fixture("realtime-arrival-sungkyunkwan.json");
const INVALID_KEY = fixture("realtime-error-invalid-key.json");
const NO_DATA = fixture("realtime-arrival-no-data.json");
const [POSITION] = POSITIONS_LINE_1.realtimePositionList as [Payload];
const [ARRIVAL] = ARRIVALS_HYEHWA.realtimeArrivalList as [Payload];

function without(payload: Payload, key: string): Payload {
  const copy = { ...payload };
  delete copy[key];
  return copy;
}

describe("seoulApiStatus", () => {
  it.each([
    ["a success, under errorMessage", POSITIONS_LINE_1.errorMessage],
    ["a refused key, bare", INVALID_KEY],
    ["no data, bare", NO_DATA],
  ])("passes the captured status of %s", (_label, status) => {
    // Act & Assert
    expect(seoulApiStatus.safeParse(status).success).toBe(true);
  });

  it.each(Object.keys(seoulApiStatus.shape))("fails without %s", (key) => {
    // Act
    const parsed = seoulApiStatus.safeParse(without(INVALID_KEY, key));

    // Assert
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual([key]);
  });
});

describe("seoulPositionBody", () => {
  it.each([
    ["1호선", POSITIONS_LINE_1],
    ["4호선", POSITIONS_LINE_4],
  ])("passes the captured %s positions", (_label, body) => {
    // Act & Assert
    expect(seoulPositionBody.safeParse(body).success).toBe(true);
  });

  it.each(Object.keys(seoulPositionBody.shape))("fails without %s", (key) => {
    // Act
    const parsed = seoulPositionBody.safeParse(without(POSITIONS_LINE_1, key));

    // Assert
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual([key]);
  });
});

describe("seoulPositionRow", () => {
  it.each(Object.keys(seoulPositionRow.shape))("fails without %s", (key) => {
    // Act
    const parsed = seoulPositionRow.safeParse(without(POSITION, key));

    // Assert
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual([key]);
  });

  it.each([
    ["trainNo", "K509"],
    ["trainNo", "509"],
    ["trainSttus", "4"],
    ["recptnDt", "20261016"],
    ["statnNm", ""],
  ])("fails with %s %j", (key, wrong) => {
    // Act
    const parsed = seoulPositionRow.safeParse({ ...POSITION, [key]: wrong });

    // Assert
    expect(parsed.success).toBe(false);
  });
});

describe("seoulArrivalBody", () => {
  it.each([
    ["혜화", ARRIVALS_HYEHWA],
    ["성균관대", ARRIVALS_SUNGKYUNKWAN],
  ])("passes the captured %s arrivals", (_label, body) => {
    // Act & Assert
    expect(seoulArrivalBody.safeParse(body).success).toBe(true);
  });

  it.each(Object.keys(seoulArrivalBody.shape))("fails without %s", (key) => {
    // Act
    const parsed = seoulArrivalBody.safeParse(without(ARRIVALS_HYEHWA, key));

    // Assert
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual([key]);
  });
});

describe("seoulArrivalRow", () => {
  it.each(Object.keys(seoulArrivalRow.shape))("fails without %s", (key) => {
    // Act
    const parsed = seoulArrivalRow.safeParse(without(ARRIVAL, key));

    // Assert
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual([key]);
  });

  it("fails with a countdown that is not a whole number of seconds", () => {
    // Act
    const parsed = seoulArrivalRow.safeParse({ ...ARRIVAL, barvlDt: "1.5" });

    // Assert
    expect(parsed.success).toBe(false);
  });
});
