/**
 * UiTransitListService over a fake BusConfigService and a fixed Clock: the
 * request's language picks the groups, the Clock's instant decides which
 * date-range groups show (whole KST days, opened later on the first day by
 * `fromTime`), and each shown group becomes its card in the order given.
 * Several instants fall on different dates in UTC and KST.
 */
import { FakeBusConfigService } from "../../../__tests__/helpers/fakes/bus/bus-config.service.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { BusConfigService } from "../../bus/config/bus-config.service";
import type { BusGroupVisibility } from "../../bus/config/bus-config.types";
import type { BusGroup } from "../../bus/config/bus-config.wire";
import type { Clock } from "../../infra/clock";
import { UiTransitListService } from "./ui-transit-list.service";

function busGroup(id: string, visibility: BusGroupVisibility, label = id): BusGroup {
  return {
    id,
    screenType: "realtime",
    label,
    visibility,
    card: { themeColor: "003626", iconType: "shuttle", busTypeText: "성대", subtitle: "" },
    screen: {
      dataEndpoint: `/bus/realtime/data/${id}`,
      refreshInterval: 10,
      lastStationIndex: 0,
      stations: [],
      routeOverlay: null,
      features: [],
    },
  };
}

const ALWAYS = busGroup("hssc", { type: "always" });
const PILOT = busGroup("pilot", { type: "dateRange", from: "2026-10-20", until: "2026-12-18" });
const FROM_NOON = busGroup("commute", { type: "dateRange", from: "2026-10-12", fromTime: "11:55", until: "2026-12-18" });

let busConfig: FakeBusConfigService;

function serviceAt(iso: string): UiTransitListService {
  const clock: Clock = { now: () => new Date(iso) };
  return new UiTransitListService(asReal<BusConfigService>(busConfig), clock);
}

beforeEach(() => {
  busConfig = new FakeBusConfigService();
  busConfig.busGroupsByLang.set("ko", [ALWAYS, PILOT, FROM_NOON]);
});

describe("UiTransitListService.listBusGroupCards", () => {
  it.each([
    ["2026-10-12T02:54:59.999Z", ["hssc"]],
    ["2026-10-12T02:55:00.000Z", ["hssc", "commute"]],
    ["2026-10-12T02:55:00.001Z", ["hssc", "commute"]],
  ])("at %s, around 11:55 KST on the first day of a fromTime range, lists %p", (iso, groupIds) => {
    // Act
    const cards = serviceAt(iso).listBusGroupCards("ko");

    // Assert
    expect(cards.map((card) => card.groupId)).toEqual(groupIds);
  });

  it.each([
    ["2026-10-19T14:59:59.999Z", ["hssc", "commute"]],
    ["2026-10-19T15:00:00.000Z", ["hssc", "pilot", "commute"]],
    ["2026-10-19T16:30:00.000Z", ["hssc", "pilot", "commute"]],
    ["2026-12-18T14:59:59.999Z", ["hssc", "pilot", "commute"]],
    ["2026-12-18T15:00:00.000Z", ["hssc"]],
  ])("at %s, around the KST date edges of the ranges, lists %p", (iso, groupIds) => {
    // Act
    const cards = serviceAt(iso).listBusGroupCards("ko");

    // Assert
    expect(cards.map((card) => card.groupId)).toEqual(groupIds);
  });

  it("shows a range on its KST first day while the UTC date is still the day before", () => {
    // Arrange
    // 01:30 KST on the 20th is 16:30 UTC on the 19th: a check in UTC would still hide the pilot.
    const service = serviceAt("2026-10-19T16:30:00Z");

    // Act
    const groupIds = service.listBusGroupCards("ko").map((card) => card.groupId);

    // Assert
    expect(groupIds).toContain("pilot");
    expect(serviceAt("2026-10-19T14:59:59.999Z").listBusGroupCards("ko").map((card) => card.groupId)).not.toContain(
      "pilot",
    );
  });

  it("maps each shown group of the request's language to its card", () => {
    // Arrange
    busConfig.busGroupsByLang.set("en", [busGroup("hssc", { type: "always" }, "HSSC Shuttle")]);

    // Act
    const cards = serviceAt("2026-10-20T00:00:00Z").listBusGroupCards("en");

    // Assert
    expect(cards).toEqual([
      {
        groupId: "hssc",
        card: { label: "HSSC Shuttle", themeColor: "003626", iconType: "shuttle", busTypeText: "성대", subtitle: null },
        action: { route: "/bus/realtime", groupId: "hssc" },
      },
    ]);
  });
});
