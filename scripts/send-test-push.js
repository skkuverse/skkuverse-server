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

const CHANNELS = ["notice_general", "miniapp_v2"];
// gcloud mints impersonated tokens for an hour; firebase-admin refreshes before this.
const TOKEN_LIFETIME_S = 3000;

function fail(message) {
  console.error(message);
  process.exit(2);
}

function parseOptions(argv) {
  try {
    return parseArgs({
      args: argv,
      options: {
        token: { type: "string" },
        title: { type: "string", default: "skkuverse test" },
        body: { type: "string", default: "test push" },
        channel: { type: "string", default: "notice_general" },
        data: { type: "string" },
        cred: { type: "string", default: "gcloud" },
        project: { type: "string" },
        impersonate: { type: "string" },
        send: { type: "boolean", default: false },
      },
    }).values;
  } catch (err) {
    return fail(err.message);
  }
}

function readOptions(argv) {
  const values = parseOptions(argv);
  if (!values.token) fail("missing --token");
  if (!values.project) fail("missing --project");
  if (!values.impersonate) fail("missing --impersonate");
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

// gcloud writes the token to stdout only; its stderr holds the reason it could not mint one.
function firstStderrLine(err) {
  const stderr = typeof err.stderr === "string" ? err.stderr : "";
  const line = stderr.split("\n").find((l) => l.trim() !== "");
  const fallback = err.code === "ENOENT" ? "gcloud is not installed or not on PATH" : `gcloud exited ${err.status}`;
  return (line ?? fallback).trim().slice(0, 200);
}

function gcloudCredential(serviceAccount) {
  const args = ["auth", "print-access-token", `--impersonate-service-account=${serviceAccount}`];
  const credential = {
    failure: undefined,
    async getAccessToken() {
      try {
        const accessToken = execFileSync("gcloud", args, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }).trim();
        return { access_token: accessToken, expires_in: TOKEN_LIFETIME_S };
      } catch (err) {
        credential.failure = firstStderrLine(err);
        throw new Error("gcloud auth print-access-token failed", { cause: err });
      }
    },
  };
  return credential;
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
  const credential = gcloudCredential(options.impersonate);
  initializeApp({ projectId: options.project, credential });

  const dryRun = !options.send;
  console.log(
    `mode=${dryRun ? "DRY-RUN (validate_only, nothing delivered)" : "LIVE SEND"} cred=gcloud as=${options.impersonate}`,
  );
  try {
    const id = await getMessaging().send(toMessage(options), dryRun);
    console.log(`ok messageId=${id}`);
  } catch (err) {
    const firstLine = String(err.message ?? err).split("\n")[0].slice(0, 300);
    console.log(`error code=${err.code ?? "?"} ${credential.failure ? `gcloud=${credential.failure}` : `message=${firstLine}`}`);
    process.exitCode = 1;
  }
}

main();
