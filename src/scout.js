const LAUNCH_WORDS = /\b(launch(?:ed|ing)?|introduc(?:e|ed|ing)|releas(?:e|ed|ing)|available|rolling out|now supports?|open[- ]source(?:d)?|api|sdk|model|plugin|agent|tool|beta|preview)\b/i;
const LAUNCH_ACTION_WORDS = /\b(introducing|announc(?:e|ed|ing)|now available|is now available|available today|launch(?:ed|ing)?|releas(?:e|ed|ing)|rolling out|now supports?|open[- ]sourc(?:e|ed|ing)|public beta|developer preview|now in the api)\b/i;
const BUILDABLE_WORDS = /\b(api|sdk|model|open[- ]source|github|plugin|mcp|download|weights|checkpoint|developers?)\b/i;
const SHIPPING_WORDS = /\b(i built|we built|i made|we made|built with|made with|just shipped|shipping|demo(?: of)?|prototype|experiment|using .{0,30}(api|model|sdk|mcp)|weekend project|just made|just built)\b/i;
const PROMOTIONAL_WORDS = /\b(you can build|lets? (?:you|developers) build|everyone build|start building|build your own)\b/i;
const STOP = new Set("the a an and or for to of in on with is are now new our your you we i this that from by as at it its introducing launch launched available model api sdk beta preview today just can use using build built open source".split(" "));

export function ageHours(tweet, now = new Date()) {
  return (now.getTime() - new Date(tweet.createdAt).getTime()) / 3_600_000;
}

export function momentum(tweet, now = new Date()) {
  const age = Math.max(ageHours(tweet, now), 0.5);
  const m = tweet.metrics;
  const weighted = m.likes + 3 * m.reposts + 4 * m.quotes + 2 * m.bookmarks + 0.25 * m.replies;
  return weighted / age;
}

function isActuallyHot(tweet, now) {
  const age = Math.max(ageHours(tweet, now), 0.5);
  const m = tweet.metrics;
  const velocity = momentum(tweet, now);
  return (
    m.likes >= 500 ||
    m.bookmarks >= 250 ||
    m.views >= 100_000 ||
    velocity >= 180 ||
    (age <= 3 && m.likes >= 120 && velocity >= 60)
  );
}

function isBuilderHot(tweet, now) {
  const m = tweet.metrics;
  return m.likes >= 100 || m.views >= 10_000 || momentum(tweet, now) >= 35;
}

function topicTokens(tweet) {
  const tokens = tweet.text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[@#]/g, " ")
    .match(/[A-Za-z][A-Za-z0-9.+_-]{2,}/g) || [];
  const author = tweet.author?.toLowerCase();
  const scored = [];
  for (const raw of tokens) {
    const token = raw.toLowerCase();
    if (STOP.has(token) || token === author || token.length < 3) continue;
    let score = 1;
    if (/[A-Z]/.test(raw.slice(1)) || /\d/.test(raw) || /[-_.+]/.test(raw)) score += 2;
    if (raw === raw.toUpperCase() && raw.length > 2) score += 1;
    scored.push({ token, score });
  }
  return [...new Map(scored.sort((a, b) => b.score - a.score).map((item) => [item.token, item])).values()]
    .slice(0, 8)
    .map((item) => item.token);
}

function topicPhrases(tweet) {
  const phrases = [];
  const pattern = /\b([A-Z][A-Za-z0-9.+_-]*(?:\s+[A-Z][A-Za-z0-9.+_-]*){0,2})\s+(API|SDK|Plugin)\b/g;
  for (const match of tweet.text.matchAll(pattern)) {
    phrases.push(`${match[1]} ${match[2]}`.toLowerCase());
  }
  for (const match of tweet.text.matchAll(/\b[A-Za-z]+(?:[-_.+][A-Za-z0-9]+)+\b/g)) {
    phrases.push(match[0].toLowerCase());
  }
  return [...new Set(phrases)].filter((phrase) => phrase.length >= 5);
}

function relatesTo(builder, launch) {
  const lower = builder.text.toLowerCase();
  if (launch.phrases.some((phrase) => lower.includes(phrase))) return true;
  const tokens = launch.tokens.filter((token) => token.length >= 4);
  return tokens.filter((token) => lower.includes(token)).length >= 2;
}

function titleFrom(tweet) {
  const first = tweet.text.replace(/https?:\/\/\S+/g, "").split(/[\n.!?]/)[0].trim();
  return first.length <= 105 ? first : `${first.slice(0, 102).trim()}…`;
}

export function findFire(tweets, options = {}) {
  const now = options.now || new Date();
  const minAge = options.minAgeHours ?? 1;
  const maxAge = options.lookbackHours ?? 24;
  const maxItems = options.maxItems ?? 3;
  const launchHandles = options.launchHandles || new Set();

  const launches = tweets
    .filter((tweet) => {
      const age = ageHours(tweet, now);
      return (
        tweet.author &&
        launchHandles.has(tweet.author.toLowerCase()) &&
        age >= minAge &&
        age <= maxAge &&
        !tweet.isReply &&
        !tweet.isQuote &&
        LAUNCH_WORDS.test(tweet.text) &&
        LAUNCH_ACTION_WORDS.test(tweet.text) &&
        BUILDABLE_WORDS.test(tweet.text) &&
        isActuallyHot(tweet, now)
      );
    })
    .map((tweet) => ({
      ...tweet,
      momentum: momentum(tweet, now),
      tokens: topicTokens(tweet),
      phrases: topicPhrases(tweet),
    }))
    .sort((a, b) => b.momentum - a.momentum);

  const deduped = [];
  for (const launch of launches) {
    const overlaps = deduped.some((existing) =>
      launch.tokens.some((token) => existing.tokens.includes(token))
    );
    if (!overlaps) deduped.push(launch);
    if (deduped.length >= maxItems) break;
  }

  return deduped.map((launch) => {
    const builders = tweets
      .filter((tweet) => {
        if (!tweet.author || tweet.author.toLowerCase() === launch.author.toLowerCase()) return false;
        const age = ageHours(tweet, now);
        return (
          age >= 0 &&
          age <= maxAge &&
          SHIPPING_WORDS.test(tweet.text) &&
          !PROMOTIONAL_WORDS.test(tweet.text) &&
          isBuilderHot(tweet, now) &&
          relatesTo(tweet, launch)
        );
      })
      .sort((a, b) => momentum(b, now) - momentum(a, now))
      .slice(0, 3);
    return { launch, builders, title: titleFrom(launch) };
  });
}

const compact = (count) =>
  new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(count || 0);

function metricLine(tweet, now) {
  const m = tweet.metrics;
  const age = Math.max(0, ageHours(tweet, now));
  const metrics = [`${compact(m.likes)} likes`];
  if (m.views) metrics.push(`${compact(m.views)} views`);
  if (m.bookmarks) metrics.push(`${compact(m.bookmarks)} saves`);
  return `${age.toFixed(age < 10 ? 1 : 0)}h · ${metrics.join(" · ")}`;
}

function tweetUrl(tweet) {
  return `https://x.com/${tweet.author}/status/${tweet.id}`;
}

export function formatReport(items, options = {}) {
  const now = options.now || new Date();
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam",
    day: "2-digit",
    month: "short",
  }).format(now);
  if (items.length === 0) return `🔥 *Fire report · ${date}*\nNothing clearly catching fire in the last 24h.`;

  const lines = [`🔥 *Fire report · ${date}*`, "", "*Catching fire*"];
  for (const item of items) {
    lines.push(`• *${item.title}* — ${metricLine(item.launch, now)}`);
    lines.push(`  ${tweetUrl(item.launch)}`);
  }

  const withBuilders = items.filter((item) => item.builders.length > 0);
  if (withBuilders.length) {
    lines.push("", "*People shipping*");
    for (const item of withBuilders) {
      for (const builder of item.builders.slice(0, 2)) {
        const summary = builder.text.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
        lines.push(`• ${summary.slice(0, 120)}${summary.length > 120 ? "…" : ""}`);
        lines.push(`  ${tweetUrl(builder)}`);
      }
    }
  }
  return lines.join("\n");
}
