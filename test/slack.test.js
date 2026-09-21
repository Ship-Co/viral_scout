import test from "node:test";
import assert from "node:assert/strict";
import { sendToSlack } from "../src/slack.js";

test("both Slack delivery methods disable text and media previews", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, ...JSON.parse(options.body) });
    return { ok: true, json: async () => ({ ok: true }) };
  };
  await sendToSlack("*Fire report* <https://x.com/example/status/1|post>", {
    webhookUrl: "https://example.test/webhook", fetchImpl,
  });
  await sendToSlack("*Fire report* <https://x.com/example/status/1|post>", {
    webhookUrl: "", botToken: "test-token", channelId: "test-channel", fetchImpl,
  });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.unfurl_links, false);
    assert.equal(call.unfurl_media, false);
    assert.match(call.text, /\*Fire report\*/);
  }
});
