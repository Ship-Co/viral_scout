const LAUNCH_WORDS = /\b(launch(?:ed|ing)?|introduc(?:e|ed|ing)|releas(?:e|ed|ing)|available|rolling out|now supports?|open[- ]source(?:d)?|api|sdk|model|plugin|agent|tool|beta|preview)\b/i;
const LAUNCH_ACTION_WORDS = /\b(introducing|announc(?:e|ed|ing)|now available|is now available|available today|launch(?:ed|ing)?|releas(?:e|ed|ing)|rolling out|now supports?|open[- ]sourc(?:ed|ing)|public beta|developer preview|now in the api|fresh updates?|we(?:'ve| have) added)\b/i;
const OWNED_LAUNCH_WORDS = /(?:^|\b)(?:today,?\s*)?(?:we(?:'re| are| have|'ve)?|i(?:'m| am| have|'ve)?)\s+(?:just\s+)?(?:introduc(?:e|ed|ing)|announc(?:e|ed|ing)|launch(?:ed|ing)?|releas(?:e|ed|ing)|open[- ]sourc(?:e|ed|ing)|shipp(?:ed|ing))\b|^introducing\b/i;
const BUILDABLE_WORDS = /\b(api|sdk|cli|model|open[- ]source|github|plugin|mcp|download|weights|checkpoint|developers?|agents?|agent harness|managed agents?)\b/i;
const PUBLIC_ACCESS_WORDS = /\b(api|sdk|cli|open[- ]sourc(?:e|ed)|github|plugin|mcp|download|weights|checkpoint|developers?|public beta|available|rolling out)\b/i;
const OWN_BUILD_WORDS = /\b(i|we|my|our)\b.{0,45}\b(built|made|created|shipped|shipping|launched|prototype[dd]?|experiment(?:ed|ing)?)\b|\b(i|we)\W*(?:'ve|have|just)?\s*(built|made|created|shipped|launched)\b/i;
const BUILD_ARTIFACT_WORDS = /\b(built with|made with|powered by|demo(?: of)?|prototype|weekend project|using .{0,30}(api|model|sdk|mcp))\b/i;
const FIRST_PERSON_ARTIFACT = /\b(i|we|my|our)\b.{0,100}\b(built|made|created|shipped|demo|prototype|app|tool|workflow|result|scene|video|image|game|site|integration)\b/i;
const PROMOTIONAL_WORDS = /\b(you can build|lets? (?:you|developers) build|everyone build|start building|build your own)\b/i;
const TECHNOLOGY_CONTEXT = /\b(ai|llm|model|api|sdk|cli|agent|coding|developer|open[- ]source|github|plugin|mcp|inference|multimodal|voice|video|image|3d|robot|benchmark|weights|checkpoint|framework|database|browser|automation)\b/i;
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

function engagementScore(tweet, now, thresholds) {
  const age = Math.max(ageHours(tweet, now), 1 / 12);
  const ageScale = age ** 0.62;
  const m = tweet.metrics;
  const weighted = m.likes + 3 * m.reposts + 4 * m.quotes + 2 * m.bookmarks + 0.25 * m.replies;
  return Math.max(
    m.likes / Math.max(thresholds.likesFloor, thresholds.likes * ageScale),
    m.views / Math.max(thresholds.viewsFloor, thresholds.views * ageScale),
    m.bookmarks / Math.max(thresholds.bookmarksFloor, thresholds.bookmarks * ageScale),
    weighted / Math.max(thresholds.weightedFloor, thresholds.weighted * ageScale)
  );
}

export function heatScore(tweet, now = new Date()) {
  return engagementScore(tweet, now, {
    likes: 120,
    likesFloor: 35,
    views: 25_000,
    viewsFloor: 6_000,
    bookmarks: 50,
    bookmarksFloor: 12,
    weighted: 240,
    weightedFloor: 80,
  });
}

export function selectClassificationCandidates(tweets, options = {}) {
  const now = options.now || new Date();
  const launchHandles = options.launchHandles || new Set();
  return tweets.filter((tweet) => {
    const heat = heatScore(tweet, now);
    const text = tweet.text || "";
    const knownLaunchSource = launchHandles.has(tweet.author?.toLowerCase());
    const launchContext = LAUNCH_WORDS.test(text) || LAUNCH_ACTION_WORDS.test(text) || OWNED_LAUNCH_WORDS.test(text);
    const builderContext = OWN_BUILD_WORDS.test(text) || BUILD_ARTIFACT_WORDS.test(text) || FIRST_PERSON_ARTIFACT.test(text);
    const technologyContext = TECHNOLOGY_CONTEXT.test(text);
    return (
      heat >= 2 ||
      (heat >= 0.65 && (technologyContext || launchContext || knownLaunchSource)) ||
      (builderContext && technologyContext)
    );
  });
}

function isActuallyHot(tweet, now) {
  return heatScore(tweet, now) >= 1;
}

function isBuilderHot(tweet, now) {
  return engagementScore(tweet, now, {
    likes: 25,
    likesFloor: 10,
    views: 3_000,
    viewsFloor: 1_500,
    bookmarks: 10,
    bookmarksFloor: 4,
    weighted: 50,
    weightedFloor: 25,
  }) >= 1;
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
  const decisions = options.decisions || new Map();
  const requireDecisions = options.requireDecisions || false;

  const launches = tweets
    .filter((tweet) => {
      const age = ageHours(tweet, now);
      const decision = decisions.get(tweet.id);
      if (requireDecisions && !decision) return false;
      const officialLaunchAccount = launchHandles.has(tweet.author?.toLowerCase());
      const selfAnnouncedPublicLaunch =
        OWNED_LAUNCH_WORDS.test(tweet.text) && PUBLIC_ACCESS_WORDS.test(tweet.text);
      const reusableTechnology =
        decision &&
        ["model_or_api", "developer_tool", "creative_tool", "open_source"].includes(decision.technologyType);
      const semanticLaunch =
        decision &&
        decision.rootLaunch >= 0.6 &&
        decision.publicAccess >= 0.55 &&
        reusableTechnology &&
        decision.buildSurface >= 0.3 &&
        decision.capabilityNovelty >= 1.45;
      const rulesLaunch =
        (officialLaunchAccount || selfAnnouncedPublicLaunch) &&
        LAUNCH_WORDS.test(tweet.text) &&
        LAUNCH_ACTION_WORDS.test(tweet.text) &&
        BUILDABLE_WORDS.test(tweet.text);
      return (
        tweet.author &&
        age >= minAge &&
        age <= maxAge &&
        !tweet.isReply &&
        !tweet.isQuote &&
        (decision ? semanticLaunch : rulesLaunch) &&
        isActuallyHot(tweet, now)
      );
    })
    .map((tweet) => ({
      ...tweet,
      momentum: momentum(tweet, now),
      heat: heatScore(tweet, now),
      decision: decisions.get(tweet.id),
      tokens: topicTokens(tweet),
      phrases: topicPhrases(tweet),
    }))
    .sort((a, b) => {
      const aNovelty = a.decision?.capabilityNovelty || 0;
      const bNovelty = b.decision?.capabilityNovelty || 0;
      return b.heat * (0.85 + 0.08 * bNovelty) - a.heat * (0.85 + 0.08 * aNovelty);
    });

  const deduped = [];
  for (const launch of launches) {
    const overlaps = deduped.some((existing) => {
      if (launch.phrases.some((phrase) => existing.phrases.includes(phrase))) return true;
      const shared = launch.tokens.filter((token) => existing.tokens.includes(token));
      const smaller = Math.max(1, Math.min(launch.tokens.length, existing.tokens.length));
      return shared.length >= 3 && shared.length / smaller >= 0.5;
    });
    if (!overlaps) deduped.push(launch);
    if (deduped.length >= maxItems) break;
  }

  return deduped.map((launch) => {
    const builders = tweets
      .filter((tweet) => {
        if (!tweet.author || tweet.author.toLowerCase() === launch.author.toLowerCase()) return false;
        const age = ageHours(tweet, now);
        const decision = decisions.get(tweet.id);
        if (requireDecisions && !decision) return false;
        const semanticBuilder =
          decision &&
          decision.builderDemo >= 0.55 &&
          decision.shippedArtifact >= 0.6 &&
          (FIRST_PERSON_ARTIFACT.test(tweet.text) || OWN_BUILD_WORDS.test(tweet.text));
        const rulesBuilder =
          OWN_BUILD_WORDS.test(tweet.text) || (tweet.hasMedia && BUILD_ARTIFACT_WORDS.test(tweet.text));
        return (
          age >= 0 &&
          age <= maxAge &&
          (decision ? semanticBuilder : rulesBuilder) &&
          (decision ? decision.commentary < 0.6 : !PROMOTIONAL_WORDS.test(tweet.text)) &&
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

export function hasHealthyCoverage(tweets, errors, sourceStats = {}) {
  const criticalErrors = errors.filter((error) => !error.startsWith("account:"));
  const feedPosts = (sourceStats["for-you"] || 0) + (sourceStats.following || 0);
  return tweets.length >= 200 && feedPosts > 0 && criticalErrors.length <= 2;
}

export function hasHealthyClassification(classification, totalPosts) {
  if (classification.disabled || totalPosts === 0) return false;
  return classification.classified / totalPosts >= 0.95;
}
