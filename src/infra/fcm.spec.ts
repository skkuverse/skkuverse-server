/**
 * postToFcmFunction under each PUSH_DELIVERY value.
 *
 * Suppressed is the development default, and the only thing between a local
 * `npm run dev` and every real subscriber of a topic: the dev Doppler config
 * points at the Cloud Function production uses. So "suppressed" must mean the
 * function is never called — not called with a flag, not called and ignored.
 *
 * The guard holds only while postToFcmFunction is the one way out, so the last
 * test fails if any other file in src/ reads the function URL or key.
 */
import fs from "fs";
import path from "path";
import config from "./config";
import logger from "./logger";
import { postToFcmFunction } from "./fcm";

const notice = {
  type: "notice",
  noticeId: "n1",
  topics: ["notices:cs"],
  title_ko: "제목",
  body_ko: "본문",
};

let savedDelivery: typeof config.push.delivery;

beforeEach(() => {
  savedDelivery = config.push.delivery;
  global.fetch = jest.fn() as unknown as typeof fetch;
});

afterEach(() => {
  config.push.delivery = savedDelivery;
  delete (global as { fetch?: typeof fetch }).fetch;
  jest.restoreAllMocks();
});

describe("postToFcmFunction with PUSH_DELIVERY=suppressed", () => {
  beforeEach(() => {
    config.push.delivery = "suppressed";
  });

  it("never calls the Cloud Function", async () => {
    await postToFcmFunction(notice);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("reports an empty delivery the callers record as a completed send", async () => {
    await expect(postToFcmFunction(notice)).resolves.toEqual({
      sent: 0,
      failed: 0,
      cleanedUp: 0,
      suppressed: true,
    });
  });

  it("returns a fresh object, so a caller mutating it cannot change the next one", async () => {
    const first = await postToFcmFunction(notice);
    first.sent = 99;
    await expect(postToFcmFunction(notice)).resolves.toMatchObject({ sent: 0 });
  });

  it("logs what would have been sent", async () => {
    const info = jest.spyOn(logger, "info").mockImplementation(() => undefined);
    await postToFcmFunction(notice);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "push.delivery.suppressed",
        type: "notice",
        noticeId: "n1",
        topics: ["notices:cs"],
      }),
      expect.any(String),
    );
  });
});

describe("postToFcmFunction with PUSH_DELIVERY=live", () => {
  beforeEach(() => {
    config.push.delivery = "live";
  });

  it("POSTs the payload to the Cloud Function", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ sent: 3, failed: 0, cleanedUp: 0 }),
    });
    await expect(postToFcmFunction(notice)).resolves.toEqual({ sent: 3, failed: 0, cleanedUp: 0 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(config.notices.dispatch.functionUrl);
    expect(JSON.parse(opts.body)).toEqual(notice);
  });
});

describe("postToFcmFunction is the only way to the Cloud Function", () => {
  // Where the URL and key may appear in code: read from env and validated
  // (config.ts, required-env.ts) and used (fcm.ts). A fetch to the
  // function anywhere else would bypass PUSH_DELIVERY. Specs are not code.
  const allowed = new Set(["infra/config.ts", "infra/required-env.ts", "infra/fcm.ts"]);
  const reference = /\bfunctionUrl\b|\bFCM_FUNCTION_URL\b|\bFCM_API_KEY\b|dispatch\.apiKey\b/;

  it("no other file in src/ reads the function URL or key", () => {
    const root = path.join(__dirname, "..");
    const offenders = fs
      .readdirSync(root, { recursive: true, encoding: "utf8" })
      .filter((rel) => rel.endsWith(".ts") && !rel.endsWith(".spec.ts"))
      .filter((rel) => !allowed.has(rel.split(path.sep).join("/")))
      .filter((rel) =>
        fs
          .readFileSync(path.join(root, rel), "utf8")
          .split("\n")
          .some((line) => !/^\s*(\*|\/\/)/.test(line) && reference.test(line)),
      );
    expect(offenders).toEqual([]);
  });
});
