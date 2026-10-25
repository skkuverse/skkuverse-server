/**
 * Every perimeter port has what ADR 0023 (D2 and D7) promises a reader of the public code: a fake a route test
 * passes (`__tests__/helpers/fakes/perimeter/<port>.fake.ts`, `Fake<Port>`), a contract suite every implementation
 * runs (`__tests__/helpers/perimeter/<port>.contract.ts`, `describe<Port>Contract`), and a local-development class
 * (`src/perimeter/local-dev/<port>.ts`, `LocalDev<Port>`). Each contract suite runs over the LocalDev classes and
 * over the overlay this build carries. The records below are typed by the port names, so a new port fails the
 * type check here until all three exist.
 */
import fs from "node:fs";
import path from "node:path";
import * as abuseSignalsFake from "../helpers/fakes/perimeter/abuse-signals.fake";
import * as internalAuthorizerFake from "../helpers/fakes/perimeter/internal-authorizer.fake";
import * as miniAppPushAuthorizerFake from "../helpers/fakes/perimeter/mini-app-push-authorizer.fake";
import * as miniAppPushQuotaFake from "../helpers/fakes/perimeter/mini-app-push-quota.fake";
import * as originTrustFake from "../helpers/fakes/perimeter/origin-trust.fake";
import * as outboundPolicyFake from "../helpers/fakes/perimeter/outbound-policy.fake";
import * as pushContentPolicyFake from "../helpers/fakes/perimeter/push-content-policy.fake";
import * as rateLimitPolicyFake from "../helpers/fakes/perimeter/rate-limit-policy.fake";
import * as requestAuthenticatorFake from "../helpers/fakes/perimeter/request-authenticator.fake";
import * as abuseSignalsContract from "../helpers/perimeter/abuse-signals.contract";
import * as internalAuthorizerContract from "../helpers/perimeter/internal-authorizer.contract";
import * as miniAppPushAuthorizerContract from "../helpers/perimeter/mini-app-push-authorizer.contract";
import * as miniAppPushQuotaContract from "../helpers/perimeter/mini-app-push-quota.contract";
import * as originTrustContract from "../helpers/perimeter/origin-trust.contract";
import * as outboundPolicyContract from "../helpers/perimeter/outbound-policy.contract";
import * as pushContentPolicyContract from "../helpers/perimeter/push-content-policy.contract";
import * as rateLimitPolicyContract from "../helpers/perimeter/rate-limit-policy.contract";
import * as requestAuthenticatorContract from "../helpers/perimeter/request-authenticator.contract";
import { ROOT } from "../helpers/architecture/ratchet";
import { LOCAL_DEV_CLASSES } from "../../src/perimeter/local-dev/perimeter-classes";
import { PORT_TOKENS, type PortName } from "../../src/perimeter/perimeter.ports";

type ModuleExports = Readonly<Record<string, unknown>>;

const FAKES: { readonly [K in PortName]: ModuleExports } = {
  requestAuthenticator: requestAuthenticatorFake,
  rateLimitPolicy: rateLimitPolicyFake,
  internalAuthorizer: internalAuthorizerFake,
  miniAppPushAuthorizer: miniAppPushAuthorizerFake,
  miniAppPushQuota: miniAppPushQuotaFake,
  pushContentPolicy: pushContentPolicyFake,
  originTrust: originTrustFake,
  outboundPolicy: outboundPolicyFake,
  abuseSignals: abuseSignalsFake,
};

const CONTRACTS: { readonly [K in PortName]: ModuleExports } = {
  requestAuthenticator: requestAuthenticatorContract,
  rateLimitPolicy: rateLimitPolicyContract,
  internalAuthorizer: internalAuthorizerContract,
  miniAppPushAuthorizer: miniAppPushAuthorizerContract,
  miniAppPushQuota: miniAppPushQuotaContract,
  pushContentPolicy: pushContentPolicyContract,
  originTrust: originTrustContract,
  outboundPolicy: outboundPolicyContract,
  abuseSignals: abuseSignalsContract,
};

const CONTRACT_RUNNERS = ["src/perimeter/local-dev/perimeter-classes.spec.ts", "src/perimeter/current/private-file"];

const PORT_NAMES = Object.keys(PORT_TOKENS) as PortName[];
const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const pascal = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);
const exists = (file: string): boolean => fs.existsSync(path.join(ROOT, file));

describe("perimeter ports", () => {
  it.each(PORT_NAMES)("give %s a fake named after the port", (name) => {
    // Act
    const fake = FAKES[name][`Fake${pascal(name)}`];

    // Assert
    expect(exists(`__tests__/helpers/fakes/perimeter/${kebab(name)}.fake.ts`)).toBe(true);
    expect(typeof fake).toBe("function");
  });

  it.each(PORT_NAMES)("give %s a contract suite, run over the LocalDev classes and the overlay", (name) => {
    // Arrange
    const suite = `describe${pascal(name)}Contract`;

    // Act
    const runners = CONTRACT_RUNNERS.filter((file) => fs.readFileSync(path.join(ROOT, file), "utf8").includes(`${suite}((deps) =>`));

    // Assert
    expect(exists(`__tests__/helpers/perimeter/${kebab(name)}.contract.ts`)).toBe(true);
    expect(typeof CONTRACTS[name][suite]).toBe("function");
    expect(runners).toEqual(CONTRACT_RUNNERS);
  });

  it.each(PORT_NAMES)("give %s a LocalDev class in its own file, extending the port", (name) => {
    // Act
    const localDev = LOCAL_DEV_CLASSES[name];

    // Assert
    expect(exists(`src/perimeter/local-dev/${kebab(name)}.ts`)).toBe(true);
    expect(localDev.name).toBe(`LocalDev${pascal(name)}`);
    expect(localDev.prototype).toBeInstanceOf(PORT_TOKENS[name]);
  });
});
