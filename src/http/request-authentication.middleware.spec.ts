/**
 * The binding of REQUEST_AUTHENTICATOR (ADR 0023, D1): a middleware, not a guard, so the principal is on the request
 * before a limiter keys on it. A rejected credential answers 401 AUTH_INVALID and never reaches the next handler, so
 * the limiter does not count it; a user or an anonymous caller goes on with its principal set.
 */
import type { Request, Response } from "express";
import { FakeRequestAuthenticator } from "../../__tests__/helpers/fakes/perimeter/request-authenticator.fake";
import { asReal } from "../../__tests__/helpers/fakes/public-of";
import type { RequestAuthenticator } from "../perimeter/perimeter.ports";
import { RequestAuthenticationMiddleware } from "./request-authentication.middleware";

interface ResStub {
  statusCode: number | undefined;
  body: unknown;
  headers: Record<string, string>;
}

function makeReq(headers: Record<string, string> = {}): Request {
  return { method: "GET", originalUrl: "/notices/tabs?x=1", ip: "203.0.113.7", get: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
}

function makeRes(): ResStub & Response {
  const stub: ResStub = { statusCode: undefined, body: undefined, headers: {} };
  const res = {
    ...stub,
    setHeader(name: string, value: string) {
      res.headers[name] = value;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res as unknown as ResStub & Response;
}

function middlewareOver(authenticator: FakeRequestAuthenticator): RequestAuthenticationMiddleware {
  return new RequestAuthenticationMiddleware(asReal<RequestAuthenticator>(authenticator));
}

describe("RequestAuthenticationMiddleware.use", () => {
  it("asks the authenticator with the request as received", async () => {
    // Arrange
    const authenticator = new FakeRequestAuthenticator();

    // Act
    await middlewareOver(authenticator).use(makeReq({ authorization: "Bearer t" }), makeRes(), jest.fn());

    // Assert
    expect(authenticator.requests.map((r) => [r.method, r.target, r.ip, r.header("Authorization")])).toEqual([["GET", "/notices/tabs?x=1", "203.0.113.7", "Bearer t"]]);
  });

  it("sets the user principal and goes on", async () => {
    // Arrange
    const authenticator = new FakeRequestAuthenticator();
    authenticator.answer = () => ({ kind: "user", uid: "alice", signInProvider: "anonymous" });
    const req = makeReq({ authorization: "Bearer t" });
    const next = jest.fn();

    // Act
    await middlewareOver(authenticator).use(req, makeRes(), next);

    // Assert
    expect(req.principal).toEqual({ kind: "user", uid: "alice", signInProvider: "anonymous" });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("sets the anonymous principal and goes on", async () => {
    // Arrange
    const req = makeReq();
    const next = jest.fn();

    // Act
    await middlewareOver(new FakeRequestAuthenticator()).use(req, makeRes(), next);

    // Assert
    expect(req.principal).toEqual({ kind: "anonymous" });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("answers a rejected credential 401 AUTH_INVALID with its response time, and does not go on", async () => {
    // Arrange
    const authenticator = new FakeRequestAuthenticator();
    authenticator.answer = () => ({ kind: "rejected" });
    const req = makeReq({ authorization: "Bearer bad" });
    const res = makeRes();
    const next = jest.fn();

    // Act
    await middlewareOver(authenticator).use(req, res, next);

    // Assert
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: { code: "AUTH_INVALID", message: "Invalid auth token" } });
    expect(res.headers["X-Response-Time"]).toMatch(/ms$/);
    expect(next).not.toHaveBeenCalled();
    expect(req.principal).toBeUndefined();
  });
});
