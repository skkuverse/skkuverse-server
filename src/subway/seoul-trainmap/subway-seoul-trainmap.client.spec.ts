/**
 * SubwaySeoulTrainmapClient against the Seoul Metro train map (design D11).
 * What it guards: one POST per line with a 5 s timeout, a User-Agent naming
 * skkuverse and no redirect followed; the page handed back as text, the
 * captured 2026-10-16 line 1 page as it came; and every failure (an HTTP
 * status, a redirect, a timeout, a body that is not text) rejecting with a
 * SubwaySeoulTrainmapError that names the source, status and code and keeps
 * neither the axios config nor the request. Parsing the page is
 * subway-seoul-trainmap.mapper.spec.ts's.
 */
import fs from "fs";
import path from "path";
import axios from "axios";

jest.mock("axios", () => {
  const actual = jest.requireActual("axios");
  return { ...actual, __esModule: true, default: { ...actual.default, post: jest.fn() }, isAxiosError: actual.isAxiosError };
});
const mockedPost = axios.post as jest.Mock;

import { SubwaySeoulTrainmapError } from "./subway-seoul-trainmap.error";
import { SubwaySeoulTrainmapClient } from "./subway-seoul-trainmap.client";

const ENDPOINT = "https://smss.seoulmetro.co.kr/traininfo/traininfoUserMap.do";
const LINE_1_PAGE = fs.readFileSync(path.join(__dirname, "../../../__tests__/nest/subway/fixtures/trainmap-line1.html"), "utf8");

const client = new SubwaySeoulTrainmapClient();

function axiosError(fields: { status?: number; code?: string }): Error {
  const requestConfig = { url: ENDPOINT, params: { line: "1", isCb: "N" }, headers: { "User-Agent": "x" } };
  const response = fields.status === undefined ? undefined : { status: fields.status, data: "", config: requestConfig, headers: {}, statusText: "" };
  return new axios.AxiosError("boom", fields.code, requestConfig as never, { path: ENDPOINT }, response as never);
}

async function failureOf(line: string): Promise<SubwaySeoulTrainmapError> {
  return (await client.fetchLinePage(line).catch((err: unknown) => err)) as SubwaySeoulTrainmapError;
}

beforeEach(() => {
  mockedPost.mockReset();
});

describe("SubwaySeoulTrainmapClient.fetchLinePage", () => {
  it("POSTs for one line with a 5 s timeout, a skkuverse User-Agent and no redirect", async () => {
    // Arrange
    mockedPost.mockResolvedValue({ status: 200, data: LINE_1_PAGE });

    // Act
    await client.fetchLinePage("1");

    // Assert
    expect(mockedPost).toHaveBeenCalledTimes(1);
    const [url, body, options] = mockedPost.mock.calls[0] as [string, unknown, Record<string, unknown>];
    expect([url, body]).toEqual([ENDPOINT, null]);
    expect(options).toMatchObject({ params: { line: "1", isCb: "N" }, timeout: 5000, maxRedirects: 0, responseType: "text" });
    expect((options.headers as Record<string, string>)["User-Agent"]).toMatch(/skkuverse/);
  });

  it("hands back the captured page as it came", async () => {
    // Arrange
    mockedPost.mockResolvedValue({ status: 200, data: LINE_1_PAGE });

    // Act & Assert
    await expect(client.fetchLinePage("1")).resolves.toBe(LINE_1_PAGE);
  });

  it.each([
    ["a 500", { status: 500, code: "ERR_BAD_RESPONSE" }, { status: 500, code: "ERR_BAD_RESPONSE" }],
    ["a redirect it does not follow, which axios rejects without a code", { status: 302 }, { status: 302 }],
    ["a timeout", { code: "ECONNABORTED" }, { code: "ECONNABORTED" }],
  ])("%s rejects with its status and code, and nothing of the request", async (_label, fields, expected) => {
    // Arrange
    mockedPost.mockRejectedValue(axiosError(fields));

    // Act
    const err = await failureOf("1");

    // Assert
    expect(err).toBeInstanceOf(SubwaySeoulTrainmapError);
    expect(err).toMatchObject({ source: "seoul-trainmap", ...expected });
    expect(err.cause).toBeUndefined();
    expect(JSON.stringify(err) + String(err.stack)).not.toContain("User-Agent");
  });

  it("a body that is not text rejects as an unexpected shape", async () => {
    // Arrange
    mockedPost.mockResolvedValue({ status: 200, data: { trains: [] } });

    // Act
    const err = await failureOf("1");

    // Assert
    expect(err).toMatchObject({ source: "seoul-trainmap", status: 200, code: "unexpected_shape" });
  });
});
