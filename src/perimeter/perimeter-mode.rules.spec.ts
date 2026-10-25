/**
 * The execution-context check behind PERIMETER_MODE and HOST (ADR 0023, D3): a process with no mode, an
 * unknown mode, a local-dev mode outside an explicit development environment or off loopback, a test mode
 * in production, or a listening role without a host must be refused before it serves anything.
 */
import { perimeterModeErrors } from "./perimeter-mode.rules";

const OVERLAY = { NODE_ENV: "production", PERIMETER_MODE: "overlay", HOST: "0.0.0.0" };
const LOCAL_DEV = { NODE_ENV: "development", PERIMETER_MODE: "local-dev", HOST: "127.0.0.1" };

describe("perimeterModeErrors", () => {
  it.each([
    ["overlay in production", OVERLAY],
    ["overlay on the poller, which listens nowhere", { NODE_ENV: "production", PERIMETER_MODE: "overlay", ROLE: "poller" }],
    ["local-dev on 127.0.0.1", LOCAL_DEV],
    ["local-dev on another 127/8 address", { ...LOCAL_DEV, HOST: "127.0.0.2" }],
    ["local-dev on ::1", { ...LOCAL_DEV, HOST: "::1" }],
    ["test under NODE_ENV=test", { NODE_ENV: "test", PERIMETER_MODE: "test", HOST: "127.0.0.1" }],
    ["test under development", { NODE_ENV: "development", PERIMETER_MODE: "test", HOST: "127.0.0.1" }],
  ])("accepts %s", (_label, env) => {
    // Act & Assert
    expect(perimeterModeErrors(env)).toEqual([]);
  });

  it.each([
    ["no mode", { NODE_ENV: "production", HOST: "0.0.0.0" }, /PERIMETER_MODE is required/],
    ["an empty mode", { NODE_ENV: "production", PERIMETER_MODE: "", HOST: "0.0.0.0" }, /PERIMETER_MODE is required/],
    ["an unknown mode", { ...OVERLAY, PERIMETER_MODE: "prod" }, /PERIMETER_MODE must be one of overlay \| local-dev \| test \(got "prod"\)/],
    ["local-dev with NODE_ENV unset", { PERIMETER_MODE: "local-dev", HOST: "127.0.0.1" }, /local-dev needs NODE_ENV=development set explicitly/],
    ["local-dev in production", { ...LOCAL_DEV, NODE_ENV: "production" }, /local-dev needs NODE_ENV=development set explicitly \(got "production"\)/],
    ["local-dev on every interface", { ...LOCAL_DEV, HOST: "0.0.0.0" }, /local-dev needs a loopback HOST \(got "0.0.0.0"\)/],
    ["local-dev on a LAN address", { ...LOCAL_DEV, HOST: "192.168.0.10" }, /local-dev needs a loopback HOST/],
    ["test in production", { ...OVERLAY, PERIMETER_MODE: "test" }, /PERIMETER_MODE=test is refused in production/],
    ["no host on an api replica", { NODE_ENV: "production", PERIMETER_MODE: "overlay", ROLE: "api" }, /HOST is required where the server listens/],
    ["no host in the combined role", { ...LOCAL_DEV, HOST: undefined }, /HOST is required where the server listens/],
    ["a host name instead of an address", { ...OVERLAY, HOST: "localhost" }, /HOST must be an IP address \(got "localhost"\)/],
  ])("refuses %s", (_label, env, message) => {
    // Act
    const errors = perimeterModeErrors(env);

    // Assert
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(message);
  });
});
