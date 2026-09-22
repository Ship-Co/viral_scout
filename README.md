# Fire Scout

A monitor for buildable AI and technology launches catching fire on X. It reads launch-account timelines through a burner account's normal web session, scans AI lists plus the For You and Following feeds, and uses TypeSafe Jev to classify promising posts. A 15-minute collector stores metric snapshots in Vercel Blob; one concise report goes to Slack at 20:00 Europe/Amsterdam.

It does not use the paid X API.

## Report format

```text
🔥 Fire report · 11 Sep

Catching fire
• GPT-Live-1 is now available in the API — 20h · 16K likes · 5.4M views
  https://x.com/OpenAIDevs/status/...

People shipping
• Yelp built an interruptible live voice demo with GPT-Live-1
  https://x.com/.../status/...
```

If nothing clears the fire threshold, the scout says so instead of fabricating a weak item. The report never adds build ideas.

## What you need

1. `X_AUTH_TOKEN` and `X_CT0` from the burner account. In Chrome while logged into x.com, open Developer Tools → Application → Cookies → `https://x.com` and copy the values for `auth_token` and `ct0`.
2. A Slack incoming webhook configured for `#general`. Put its URL in `SLACK_WEBHOOK_URL`.
3. A TypeSafe API key in `TYPESAFE_API_KEY`. Jev makes the high-volume semantic decisions: root launch vs. follow-up, public buildability, technology type, and real builder demo vs. commentary.

These are secrets. Keep them in `.env` locally or GitHub Actions secrets; never commit them.

## Run locally

```bash
cp .env.example .env
# fill the three values above
npm test
npm run dry-run   # prints without posting to Slack
npm run scout     # posts to Slack immediately
```

## Production loop

Vercel calls `/api/tick` every 15 minutes. Each tick scans recent feeds, rotates through direct launch accounts, classifies newly discovered candidates, and updates persistent engagement history. At 20:00 Amsterdam the same endpoint runs a deep crawl and sends the daily report. Local-time checking handles daylight saving automatically and persistent state prevents duplicate reports.

Set `DIGEST_HOUR_AMSTERDAM` to change the local delivery hour. The default is `20`.

## Tuning

- `LAUNCH_HANDLES`: accounts allowed to originate a launch.
- `X_LIST_IDS`: X lists used as the wider launch and builder radar.
- `MIN_AGE_HOURS`, `LOOKBACK_HOURS`, `MAX_REPORT_ITEMS`: freshness and length.
- `X_*_MAX_PAGES`: high safety caps; each feed stops earlier once it has paged beyond the 24-hour cutoff.
- `X_REQUEST_CONCURRENCY`, `X_REQUEST_INTERVAL_MS`: global pacing for the session-based X reads.
- X's private web operation IDs sometimes change. The three `X_*_QUERY_ID` settings make those repairable without changing code.

The monitor is deliberately conservative: a fresh post from a major account does not qualify unless its engagement or engagement speed is strong. It rejects replies and ordinary quote posts as root launches. A hot quote post from a known model lab can qualify when Jev strongly identifies it as a publicly available, buildable model launch.

Ordinary code computes age-adjusted heat and measured growth between snapshots. Jev handles semantic judgment for potentially hot technology posts and plausible builder artifacts; previous decisions are reused. Repeated independent posts are clustered around distinctive technology names, allowing the scout to surface an event even when its original account is outside the watchlist. If source or Jev coverage is incomplete, the run fails closed and does not send a degraded Slack report.
