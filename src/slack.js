export async function sendToSlack(text) {
  if (process.env.SLACK_WEBHOOK_URL) {
    const response = await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, unfurl_links: false }),
    });
    if (!response.ok) throw new Error(`Slack webhook failed (${response.status}): ${await response.text()}`);
    return;
  }

  if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_CHANNEL_ID) {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel: process.env.SLACK_CHANNEL_ID, text, unfurl_links: false }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(`Slack API failed: ${result.error || response.status}`);
    return;
  }

  throw new Error("Missing Slack configuration. Set SLACK_WEBHOOK_URL, or SLACK_BOT_TOKEN plus SLACK_CHANNEL_ID.");
}
