export async function sendToSlack(text, options = {}) {
  const webhookUrl = options.webhookUrl ?? process.env.SLACK_WEBHOOK_URL;
  const botToken = options.botToken ?? process.env.SLACK_BOT_TOKEN;
  const channelId = options.channelId ?? process.env.SLACK_CHANNEL_ID;
  const fetchImpl = options.fetchImpl || fetch;
  if (webhookUrl) {
    const response = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, unfurl_links: false, unfurl_media: false }),
    });
    if (!response.ok) throw new Error(`Slack webhook failed (${response.status}): ${await response.text()}`);
    return;
  }

  if (botToken && channelId) {
    const response = await fetchImpl("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        authorization: `Bearer ${botToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel: channelId, text, unfurl_links: false, unfurl_media: false }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(`Slack API failed: ${result.error || response.status}`);
    return;
  }

  throw new Error("Missing Slack configuration. Set SLACK_WEBHOOK_URL, or SLACK_BOT_TOKEN plus SLACK_CHANNEL_ID.");
}
