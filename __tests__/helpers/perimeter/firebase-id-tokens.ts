/**
 * Firebase ID tokens a test signs with a key pair of its own, and Google's public-key endpoint answered from
 * 127.0.0.1 with that key, so the real firebase-admin verifies them end to end without reaching Google.
 */
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { LoopbackServers } from "../nest/loopback-servers";

// QUIRK(firebase-admin): its token verifier fetches the ID-token signing keys from this URL over node:https.
const KEY_HOST = "www.googleapis.com";
const KEY_PATH = "/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const KEY_ID = "test-signing-key";

export interface IdTokenClaims {
  projectId: string;
  uid: string;
  signInProvider: string;
}

export interface SignOptions {
  /** Signs with this key instead of the one the key endpoint serves. */
  key?: KeyObject;
  /** Issued two hours ago, so it expired an hour ago. */
  isExpired?: boolean;
}

export class LocalFirebaseSigningKey {
  private readonly servers = new LoopbackServers();
  private readonly keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  private redirect: jest.SpyInstance | undefined;
  /** While true, the key endpoint answers 500. A 503 fails the same way, after firebase-admin retries it for about 7 s. */
  isKeyEndpointDown = false;

  /** Answers firebase-admin's key fetch with this key until `stop`. Every other https request goes out unchanged. */
  async start(): Promise<void> {
    const publicKey = this.keyPair.publicKey.export({ type: "spki", format: "pem" });
    // WHY: max-age=0, because firebase-admin caches the keys per app for max-age, and another test's key differs.
    const server = await this.servers.serve((_req, res) => {
      if (this.isKeyEndpointDown) {
        res.writeHead(500).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json", "cache-control": "max-age=0" });
      res.end(JSON.stringify({ [KEY_ID]: publicKey }));
    });
    const { port } = server.address() as AddressInfo;
    const realRequest = https.request.bind(https) as (...args: unknown[]) => http.ClientRequest;
    this.redirect = jest.spyOn(https, "request").mockImplementation(((...args: unknown[]) => {
      const [options, callback] = args as [http.RequestOptions, (res: http.IncomingMessage) => void];
      if (options.hostname !== KEY_HOST || options.path !== KEY_PATH) return realRequest(...args);
      return http.request({ host: "127.0.0.1", port, path: options.path, method: options.method, headers: options.headers }, callback);
    }) as unknown as typeof https.request);
  }

  async stop(): Promise<void> {
    this.redirect?.mockRestore();
    this.redirect = undefined;
    await this.servers.closeAll();
  }

  /** A token Firebase Auth would issue for this project and user, valid for the next hour unless `isExpired`. */
  sign(claims: IdTokenClaims, { key = this.keyPair.privateKey, isExpired = false }: SignOptions = {}): string {
    // WHY: firebase-admin checks iat and exp against its own clock, which a test cannot fix.
    const issuedAtSeconds = Math.floor(Date.now() / 1000) - (isExpired ? 7200 : 0);
    const header = encode({ alg: "RS256", kid: KEY_ID, typ: "JWT" });
    const payload = encode({
      iss: `https://securetoken.google.com/${claims.projectId}`,
      aud: claims.projectId,
      sub: claims.uid,
      user_id: claims.uid,
      iat: issuedAtSeconds,
      auth_time: issuedAtSeconds,
      exp: issuedAtSeconds + 3600,
      firebase: { identities: {}, sign_in_provider: claims.signInProvider },
    });
    const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), key).toString("base64url");
    return `${header}.${payload}.${signature}`;
  }
}

/** A private key whose public half no key endpoint serves, to sign a token that must fail its signature check. */
export function strangerSigningKey(): KeyObject {
  return generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
}

function encode(part: object): string {
  return Buffer.from(JSON.stringify(part)).toString("base64url");
}
