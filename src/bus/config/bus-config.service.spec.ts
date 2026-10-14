/**
 * BusConfigService: the bus groups in order, per-language ETags (md5 hex),
 * unknown → null, and the rule that groups using no v2 field serialize
 * exactly as before (design D5). The fixture was captured from
 * `getGroupById` / `computeGroupEtag` on the code as it stood before v2
 * (2026-10-08). If it ever has to be re-captured, the change that does so is
 * changing what installed apps receive — say so in the commit. The `campus`
 * group left it when it gained v2 fields; campus-shuttle.test.ts checks its v1
 * fields against fixtures/bus-config-campus-v1.json instead.
 */
import fs from "fs";
import path from "path";
import type { SupportedLang } from "../../infra/types";
import { BusStopsService } from "../stops/bus-stops.service";
import { BusConfigService } from "./bus-config.service";

const FIXTURE: Record<string, { json: string; etag: string }> = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../../__tests__/nest/bus/fixtures/bus-config-v1-groups.json"), "utf8"),
);

let service: BusConfigService;

beforeEach(() => {
  service = new BusConfigService(new BusStopsService());
});

describe("BusConfigService.getBusGroups", () => {
  it("returns groups array with 7 items", () => {
    // Act
    const groups = service.getBusGroups("ko");

    // Assert
    expect(Array.isArray(groups)).toBe(true);
    expect(groups).toHaveLength(7);
  });

  it("each group has id, screenType, label, visibility, card, screen", () => {
    // Act & Assert
    for (const g of service.getBusGroups("ko")) {
      expect(g).toHaveProperty("id");
      expect(g).toHaveProperty("screenType");
      expect(g).toHaveProperty("label");
      expect(g).toHaveProperty("visibility");
      expect(g).toHaveProperty("card");
      expect(g).toHaveProperty("screen");
    }
  });

  it("realtime groups have screen.dataEndpoint, stations, refreshInterval", () => {
    // Act
    const realtime = service
      .getBusGroups("ko")
      .filter((g: any) => g.screenType === "realtime");

    // Assert
    expect(realtime.length).toBeGreaterThan(0);
    for (const g of realtime as any[]) {
      expect(g.screen).toHaveProperty("dataEndpoint");
      expect(g.screen.dataEndpoint).toMatch(/^\/bus\/realtime\/data\//);
      expect(g.screen).toHaveProperty("refreshInterval");
      expect(typeof g.screen.refreshInterval).toBe("number");
      expect(Array.isArray(g.screen.stations)).toBe(true);
      expect(g.screen.stations.length).toBeGreaterThan(0);
      expect(g.screen.stations[0]).toHaveProperty("index", 0);
      expect(g.screen.stations[0]).toHaveProperty("name");
    }
  });

  it("schedule groups have services with endpoint, defaultServiceId, routeBadges", () => {
    // Act
    const schedule = service
      .getBusGroups("ko")
      .filter((g: any) => g.screenType === "schedule");

    // Assert
    expect(schedule.length).toBeGreaterThan(0);
    for (const g of schedule as any[]) {
      expect(g.screen).toHaveProperty("defaultServiceId");
      expect(g.screen).toHaveProperty("services");
      expect(g.screen).toHaveProperty("routeBadges");
      expect(Array.isArray(g.screen.services)).toBe(true);
      for (const svc of g.screen.services) {
        expect(svc).toHaveProperty("serviceId");
        expect(svc).toHaveProperty("label");
        expect(svc).toHaveProperty("endpoint");
        expect(svc.endpoint).toMatch(/^\/bus\/schedule\/data\//);
      }
    }
  });

  it("campus has no hero card: the ETA it showed is retired", () => {
    // A non-null heroCard makes the app request GET /bus/campus/eta, which no
    // longer exists. null is the shape the app renders as "no card".
    // Arrange
    const campus: any = service
      .getBusGroups("ko")
      .find((g: any) => g.id === "campus");

    // Act & Assert
    expect(campus.screen.heroCard).toBeNull();
  });

  it("fasttrack has dateRange visibility with valid ISO dates", () => {
    // Arrange
    const fasttrack: any = service
      .getBusGroups("ko")
      .find((g: any) => g.id === "fasttrack");

    // Act & Assert
    expect(fasttrack.visibility.type).toBe("dateRange");
    expect(fasttrack.visibility.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fasttrack.visibility.until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("groups other than fasttrack and commute have visibility.type always", () => {
    // Act
    const nonFt = service
      .getBusGroups("ko")
      .filter((g: any) => g.id !== "fasttrack" && g.id !== "commute");

    // Assert
    for (const g of nonFt as any[]) {
      expect(g.visibility).toEqual({ type: "always" });
    }
  });

  it("group order is hssc, campus, fasttrack, commute, jongro02, jongro07, jongro08", () => {
    // Act
    const ids = service.getBusGroups("ko").map((g: any) => g.id);

    // Assert
    expect(ids).toEqual(["hssc", "campus", "fasttrack", "commute", "jongro02", "jongro07", "jongro08"]);
  });

  it("English translations differ from Korean", () => {
    // Arrange
    const ko = service.getBusGroups("ko");

    // Act
    const en = service.getBusGroups("en");

    // Assert
    expect((en[0] as any).label).not.toBe((ko[0] as any).label);
  });

  it("default lang (omitted) equals 'ko'", () => {
    // Act & Assert
    expect((service.getBusGroups()[0] as any).label).toBe(
      (service.getBusGroups("ko")[0] as any).label,
    );
  });
});

describe("BusConfigService.computeEtag", () => {
  it("ETag matches md5 hex format", () => {
    // Act & Assert
    expect(service.computeEtag("ko")).toMatch(/^"[a-f0-9]{32}"$/);
  });

  it("same language returns same ETag", () => {
    // Act & Assert
    expect(service.computeEtag("ko")).toBe(service.computeEtag("ko"));
  });

  it("different ETag per language", () => {
    // Act & Assert
    expect(service.computeEtag("ko")).not.toBe(service.computeEtag("en"));
  });
});

describe("BusConfigService.getGroupById", () => {
  it("returns group for known id", () => {
    // Arrange
    const group: any = service.getGroupById("campus", "ko");

    // Act & Assert
    expect(group).not.toBeNull();
    expect(group.id).toBe("campus");
    expect(group).toHaveProperty("screenType");
    expect(group).toHaveProperty("screen");
  });

  it("returns null for unknown id", () => {
    // Act & Assert
    expect(service.getGroupById("nonexistent", "ko")).toBeNull();
  });
});

describe("BusConfigService.computeGroupEtag", () => {
  it("returns md5 hex format for known id", () => {
    // Act & Assert
    expect(service.computeGroupEtag("campus", "ko")).toMatch(/^"[a-f0-9]{32}"$/);
  });

  it("returns null for unknown id", () => {
    // Act & Assert
    expect(service.computeGroupEtag("nonexistent", "ko")).toBeNull();
  });

  it("same id+lang returns same etag", () => {
    // Act & Assert
    expect(service.computeGroupEtag("hssc", "ko")).toBe(
      service.computeGroupEtag("hssc", "ko"),
    );
  });

  it("different lang returns different etag", () => {
    // Act & Assert
    expect(service.computeGroupEtag("hssc", "ko")).not.toBe(
      service.computeGroupEtag("hssc", "en"),
    );
  });
});

describe("groups without v2 fields", () => {
  it.each(Object.keys(FIXTURE).filter((key) => key !== "_about"))("%s matches the pre-v2 body and ETag byte for byte", (key) => {
    // Arrange
    const [id, lang] = key.split(":") as [string, SupportedLang];

    // Act & Assert
    expect(JSON.stringify(service.getGroupById(id, lang))).toBe(FIXTURE[key]!.json);
    expect(service.computeGroupEtag(id, lang)).toBe(FIXTURE[key]!.etag);
  });
});

describe("Retired fields", () => {
  it.each(["ko", "en", "zh"] as const)("no served stop of any group has exit or walkPath (%s)", (lang) => {
    // Act
    const stops = service.getBusGroups(lang).flatMap((g) => ((g.screen as { stops?: object[] }).stops ?? []) as object[]);

    // Assert
    expect(stops.length).toBeGreaterThan(0);
    for (const stop of stops) {
      expect(stop).not.toHaveProperty("exit");
      expect(stop).not.toHaveProperty("walkPath");
    }
  });
});
