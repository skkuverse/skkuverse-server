/**
 * The skkuverse-ai client: request shape, timeouts, and the classification of
 * every outcome the service has to degrade on.
 */
jest.mock("axios");

import axios from "axios";
import { aiResponse, candidate } from "../../../__tests__/helpers/overview-fixtures";
import { NoticesOverviewClient } from "./notices-overview.client";
import { AI_TIMEOUT_MS } from "./notices-overview.constants";
import { toAiNotice } from "./notices-overview.mapper";

const post = axios.post as jest.Mock;

const body = {
  query: "장학금",
  notices: [toAiNotice(candidate())],
  now: "2026-10-06T08:00:00.000Z",
  lang: "ko",
};

function reply(status: number, data: unknown) {
  post.mockResolvedValueOnce({ status, data });
}

beforeEach(() => post.mockReset());

describe("NoticesOverviewClient.postOverview", () => {
  it("posts the body to the configured ai URL with a 22 s timeout and abort signal", async () => {
    // Arrange
    reply(200, aiResponse());

    // Act
    await new NoticesOverviewClient().postOverview(body);

    // Assert
    expect(post).toHaveBeenCalledTimes(1);
    const [url, sent, opts] = post.mock.calls[0]!;
    expect(url).toBe("http://test-ai/api/notices/overview");
    expect(sent).toBe(body);
    expect(opts.timeout).toBe(AI_TIMEOUT_MS);
    expect(AI_TIMEOUT_MS).toBeGreaterThanOrEqual(22_000);
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect(opts.validateStatus(500)).toBe(true);
  });

  it("returns a parsed answer on 200", async () => {
    // Act
    reply(200, aiResponse());

    // Assert
    await expect(new NoticesOverviewClient().postOverview(body)).resolves.toEqual({
      kind: "ok",
      response: aiResponse(),
    });
  });

  it("flags a 200 that breaks the contract", async () => {
    // Act
    reply(200, { status: "answered" });

    // Assert
    await expect(new NoticesOverviewClient().postOverview(body)).resolves.toEqual({ kind: "malformed" });
  });

  it.each([
    [502, { detail: { code: "invalid_output" } }, "invalid_output"],
    [504, { detail: { code: "timeout" } }, "timeout"],
    [422, { detail: [{ loc: ["body", "query"] }] }, null],
    [500, "Internal Server Error", null],
  ])("reports %i as failed", async (status, data, code) => {
    // Act
    reply(status, data);

    // Assert
    await expect(new NoticesOverviewClient().postOverview(body)).resolves.toEqual({
      kind: "failed",
      httpStatus: status,
      code,
    });
  });

  it("reports a transport timeout", async () => {
    // Act
    post.mockRejectedValueOnce(Object.assign(new Error("timeout of 22000ms exceeded"), { code: "ECONNABORTED" }));

    // Assert
    await expect(new NoticesOverviewClient().postOverview(body)).resolves.toEqual({
      kind: "failed",
      httpStatus: null,
      code: "timeout",
    });
  });

  it("reports a connection error", async () => {
    // Act
    post.mockRejectedValueOnce(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));

    // Assert
    await expect(new NoticesOverviewClient().postOverview(body)).resolves.toEqual({
      kind: "failed",
      httpStatus: null,
      code: "network_error",
    });
  });

  it("reads retryAt from a 503 budget_exhausted", async () => {
    // Act
    reply(503, { detail: { code: "budget_exhausted", retryAt: "2026-10-07T00:00:00Z" } });

    // Assert
    await expect(new NoticesOverviewClient().postOverview(body)).resolves.toEqual({
      kind: "budget_exhausted",
      retryAt: new Date("2026-10-07T00:00:00Z"),
    });
  });

  it.each([
    ["missing", { detail: { code: "budget_exhausted" } }],
    ["unparseable", { detail: { code: "budget_exhausted", retryAt: "tomorrow" } }],
  ])("returns a null retryAt when it is %s", async (_label, data) => {
    // Act
    reply(503, data);

    // Assert
    await expect(new NoticesOverviewClient().postOverview(body)).resolves.toEqual({
      kind: "budget_exhausted",
      retryAt: null,
    });
  });
});
