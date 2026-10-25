/**
 * Where each perimeter mode's implementations come from (ADR 0023, D2 and D4): overlay mode loads the entry this
 * build carries, local-dev the public LocalDev classes, and test mode resolves every port to a stub that extends the
 * port and throws on first use, naming the port and its fake, while Nest's lifecycle probes find nothing to call.
 */
import { LOCAL_DEV_CLASSES } from "./local-dev/perimeter-classes";
import { loadOverlayEntry } from "./perimeter-overlay.rules";
import { perimeterClassesFor, toTestStub } from "./perimeter-registry.rules";
import { PORT_NAMES, PORT_TOKENS } from "./perimeter.ports";

describe("perimeterClassesFor", () => {
  it("loads the overlay entry in overlay mode and the LocalDev classes in local-dev mode", () => {
    // Act & Assert
    expect(perimeterClassesFor("overlay")).toBe(loadOverlayEntry().classes);
    expect(perimeterClassesFor("overlay")).not.toBe(LOCAL_DEV_CLASSES);
    expect(perimeterClassesFor("local-dev")).toBe(LOCAL_DEV_CLASSES);
  });
});

describe("toTestStub", () => {
  it.each(PORT_NAMES)("stubs %s as an instance of the port", (name) => {
    // Act
    const stub = toTestStub(name);

    // Assert
    expect(stub).toBeInstanceOf(PORT_TOKENS[name]);
  });

  it("throws on first use, naming the port, the method and the fake to pass", () => {
    // Arrange
    const originTrust = toTestStub("originTrust");
    const outboundPolicy = toTestStub("outboundPolicy");

    // Act & Assert
    expect(() => originTrust.isCorsOrigin("https://webview.skkuverse.com")).toThrow(
      "ORIGIN_TRUST.isCorsOrigin has no implementation under PERIMETER_MODE=test: pass its fake in buildTestApp's overrides",
    );
    expect(() => outboundPolicy.requestConfig("notice-attachment")).toThrow(/^OUTBOUND_POLICY\.requestConfig has no implementation/);
  });

  it("offers Nest's lifecycle probes and an await nothing to call", () => {
    // Arrange
    const stub = toTestStub("requestAuthenticator") as unknown as Record<string, unknown>;

    // Act
    const probed = ["onModuleInit", "onApplicationBootstrap", "onModuleDestroy", "beforeApplicationShutdown", "onApplicationShutdown", "then"].map((hook) => stub[hook]);

    // Assert
    expect(probed.every((value) => value === undefined)).toBe(true);
  });
});
