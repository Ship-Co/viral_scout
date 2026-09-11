# Fire Scout

A small daily monitor for buildable AI and technology launches catching fire on X. It reads launch-account timelines directly through a burner account's normal web session, uses wider AI lists and feeds to find related builder posts, and sends one concise report to Slack at 09:00 Europe/Amsterdam.

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

If nothing clears the fire threshold, the scout stays silent. The report never adds build ideas.

## What you need

1. `X_AUTH_TOKEN` and `X_CT0` from the burner account. In Chrome while logged into x.com, open Developer Tools → Application → Cookies → `https://x.com` and copy the values for `auth_token` and `ct0`.
2. A Slack incoming webhook configured for `#general`. Put its URL in `SLACK_WEBHOOK_URL`.

These are secrets. Keep them in `.env` locally or GitHub Actions secrets; never commit them.

## Run locally

```bash
cp .env.example .env
# fill the three values above
npm test
npm run dry-run   # prints without posting to Slack
npm run scout     # posts to Slack when it is 09:00 Amsterdam
```

## Run daily

The live deployment uses Vercel cron. Two UTC slots handle Amsterdam daylight saving time; each endpoint checks the date and exactly one performs the scan.

The included GitHub Actions workflow is an alternative if you prefer running it from GitHub.

### GitHub Actions alternative

Push this folder to a private GitHub repository and add three repository secrets under Settings → Secrets and variables → Actions:

- `X_AUTH_TOKEN`
- `X_CT0`
- `SLACK_WEBHOOK_URL`

The workflow has winter and summer UTC schedules. It identifies which one represents 09:00 Amsterdam on that date, so exactly one sends even if GitHub starts it late. You can also run it manually from the Actions tab.

## Tuning

- `LAUNCH_HANDLES`: accounts allowed to originate a launch.
- `X_LIST_IDS`: X lists used as the wider launch and builder radar.
- `MIN_AGE_HOURS`, `LOOKBACK_HOURS`, `MAX_REPORT_ITEMS`: freshness and length.
- X's private web operation IDs sometimes change. The three `X_*_QUERY_ID` settings make those repairable without changing code.

The monitor is deliberately conservative: a fresh post from a major account does not qualify unless its engagement or engagement speed is strong. It also rejects replies and quote posts as root launches, which prevents the low-engagement follow-up mistake described in the brief.
