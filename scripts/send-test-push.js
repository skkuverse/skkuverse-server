#!/usr/bin/env node
/**
 * (A collector detail is left out of the public history.)
 *
 *
 *
 *
 */
const { execFileSync } = require("node:child_process");
const { parseArgs } = require("node:util");
const { initializeApp } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");

const PROJECT_ID = "skkubus-95723";
const SENDER = "sender@project.example";
const CHANNELS = ["notice_general", "miniapp_v2"];
// gcloud mints impersonated tokens for an hour; firebase-admin refreshes before this.
const TOKEN_LIFETIME_S = 3000;

function fail(message) {
  console.error(message);
  process.exit(2);
}

function readOptions(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      token: { type: "string" },
      title: { type: "string", default: "skkuverse test" },
      body: { type: "string", default: "test push" },
      channel: { type: "string", default: "notice_general" },
      data: { type: "string" },
      cred: { type: "string", default: "gcloud" },
      impersonate: { type: "string", default: SENDER },
      send: { type: "boolean", default: false },
    },
  });
  if (!values.token) fail("missing --token");
  if (values.cred !== "gcloud") fail("--cred must be gcloud: this script holds no key");
  if (!CHANNELS.includes(values.channel)) fail(`--channel must be one of ${CHANNELS.join(", ")}`);
  return { ...values, data: values.data === undefined ? undefined : readData(values.data) };
}

function readData(json) {
  let data;
  try {
    data = JSON.parse(json);
  } catch (_err) {
    fail("--data is not JSON");
  }
  const isStringMap =
    data !== null && typeof data === "object" && !Array.isArray(data) && Object.values(data).every((v) => typeof v === "string");
  if (!isStringMap) fail("--data must be a JSON object of string values (FCM data values are strings)");
  return data;
}

function gcloudCredential(serviceAccount) {
  const args = ["auth", "print-access-token", `--impersonate-service-account=${serviceAccount}`];
  return {
    async getAccessToken() {
      const accessToken = execFileSync("gcloud", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      return { access_token: accessToken, expires_in: TOKEN_LIFETIME_S };
    },
  };
}

function toMessage(options) {
  return {
    token: options.token,
    notification: { title: options.title, body: options.body },
    ...(options.data ? { data: options.data } : {}),
    android: { priority: "high", notification: { channelId: options.channel } },
    apns: { payload: { aps: { sound: "default", mutableContent: true } } },
    fcmOptions: { analyticsLabel: "ops_test" },
  };
}

async function main() {
  const options = readOptions(process.argv.slice(2));
  initializeApp({ projectId: PROJECT_ID, credential: gcloudCredential(options.impersonate) });

  const dryRun = !options.send;
  console.log(
    `mode=${dryRun ? "DRY-RUN (validate_only, nothing delivered)" : "LIVE SEND"} cred=gcloud as=${options.impersonate}`,
  );
  try {
    const id = await getMessaging().send(toMessage(options), dryRun);
    console.log(`ok messageId=${id}`);
  } catch (err) {
    const firstLine = String(err.message ?? err).split("\n")[0].slice(0, 300);
    console.log(`error code=${err.code ?? "?"} message=${firstLine}`);
    process.exitCode = 1;
  }
}

main();
