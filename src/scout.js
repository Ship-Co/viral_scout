const LAUNCH_WORDS = /\b(launch(?:ed|ing)?|introduc(?:e|ed|ing)|releas(?:e|ed|ing)|available|rolling out|now supports?|open[- ]source(?:d)?|api|sdk|model|plugin|agent|tool|beta|preview)\b/i;
const LAUNCH_ACTION_WORDS = /\b(introducing|announc(?:e|ed|ing)|now available|is now available|available today|launch(?:ed|ing)?|releas(?:e|ed|ing)|rolling out|now supports?|open[- ]sourc(?:ed|ing)|public beta|developer preview|now in the api|fresh updates?|we(?:'ve| have) added)\b/i;
const OWNED_LAUNCH_WORDS = /(?:^|\b)(?:today,?\s*)?(?:we(?:'re| are| have|'ve)?|i(?:'m| am| have|'ve)?)\s+(?:just\s+)?(?:introduc(?:e|ed|ing)|announc(?:e|ed|ing)|launch(?:ed|ing)?|releas(?:e|ed|ing)|open[- ]sourc(?:e|ed|ing)|shipp(?:ed|ing))\b|^introducing\b/i;
const BUILDABLE_WORDS = /\b(api|sdk|cli|model|open[- ]source|github|plugin|mcp|download|weights|checkpoint|developers?|agents?|agent harness|managed agents?)\b/i;
const PUBLIC_ACCESS_WORDS = /\b(api|sdk|cli|open[- ]sourc(?:e|ed)|github|plugin|mcp|download|weights|checkpoint|developers?|public beta|available|rolling out)\b/i;
const OWN_BUILD_WORDS = /\b(i|we|my|our)\b.{0,45}\b(built|made|created|shipped|shipping|launched|prototype[dd]?|experiment(?:ed|ing)?)\b|\b(i|we)\W*(?:'ve|have|just)?\s*(built|made|created|shipped|launched)\b/i;
const BUILD_ARTIFACT_WORDS = /\b(built with|made with|powered by|demo(?: of)?|prototype|weekend project|using .{0,30}(api|model|sdk|mcp))\b/i;
const FIRST_PERSON_ARTIFACT = /\b(i|we|my|our)\b.{0,100}\b(built|made|created|shipped|demo|prototype|app|tool|workflow|result|scene|video|image|game|site|integration)\b/i;
const CONCRETE_BUILD_ACTION = /\b(i|we)\b.{0,90}\b(built|rebuilt|made|created|shipped|released|launched|implemented|integrated|ported|added|used\s+\S+\s+to|asked\s+\S+\s+to)\b/i;
const CONCRETE_ARTIFACT_CLAIM = /\b(my|our)\b.{0,100}\b(prototype|app|tool|workflow|integration|game|site|scene|apartment|room)\b.{0,100}\b(is live|works|result|became|turned into|shipped|launched)\b/i;
const PROMOTIONAL_WORDS = /\b(you can build|lets? (?:you|developers) build|everyone build|start building|build your own)\b/i;
const TECHNOLOGY_CONTEXT = /\b(ai|llm|model|api|sdk|cli|agent|coding|developer|open[- ]source|github|plugin|mcp|inference|multimodal|voice|video|image|3d|robot|benchmark|weights|checkpoint|framework|database|browser|automation)\b/i;
const CLOSED_VERTICAL = /\bfor\s+(law|legal|financial services|finance|healthcare|government|enterprise)\b/i;
const PRODUCT_NAME_STOP = new Set("Today Introducing We Our The This That Read Want Check Get Getting All Join Through System One API SDK AI LLM Your Next Now Meet People Inspired After Before From Here There More New Open Source Start Welcome What Another Faster Using Available Just First".toLowerCase().split(" "));
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
  const snapshotScore = engagementScore(tweet, now, {
    likes: 120,
    likesFloor: 35,
    views: 25_000,
    viewsFloor: 6_000,
    bookmarks: 50,
    bookmarksFloor: 12,
    weighted: 240,
    weightedFloor: 80,
  });
  const velocity = tweet.observed?.velocity;
  if (!velocity) return snapshotScore;
  const weightedPerHour = velocity.likes + 3 * velocity.reposts + 4 * velocity.quotes + 2 * velocity.bookmarks;
  const velocityScore = Math.max(
    velocity.likes / 100,
    velocity.views / 18_000,
    velocity.bookmarks / 40,
    weightedPerHour / 220
  );
  const acceleration = Math.min(2, Math.max(0.75, tweet.observed.acceleration || 1));
  return Math.max(snapshotScore, velocityScore * acceleration);
}

export function hasConcreteArtifact(tweet) {
  return CONCRETE_BUILD_ACTION.test(tweet.text || "") || CONCRETE_ARTIFACT_CLAIM.test(tweet.text || "");
}

function isClosedVerticalProduct(tweet) {
  const text = tweet.text || "";
  if (!CLOSED_VERTICAL.test(text)) return false;
  const partnerAnnouncement = /\b(proud|excited|thrilled)\b.{0,80}\b(support|partner|collaborat|launch)\b/i.test(text);
  return partnerAnnouncement || !/\b(api|sdk|cli|open[- ]source|github|plugin|mcp|weights|repository)\b/i.test(text);
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
      builderContext
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

function productNames(tweet) {
  const names = [];
  const text = (tweet.text || "").replace(/https?:\/\/\S+/g, "");
  for (const match of text.matchAll(/\b[A-Z][A-Za-z0-9_-]{2,}\b/g)) {
    const name = match[0];
    if (!PRODUCT_NAME_STOP.has(name.toLowerCase())) names.push(name);
  }
  return [...new Set(names)].slice(0, 6);
}

export function launchProductNames(tweet) {
  const text = tweet.text || "";
  const modelPatterns = [
    /\bGPT[- ]?\d+(?:\.\d+)?(?:\s+[A-Z][A-Za-z0-9-]+)?\b/g,
    /\bGrok\s+\d+(?:\.\d+)?(?:\s+[A-Z][A-Za-z0-9-]+)?\b/g,
    /\bClaude\s+(?:(?:Opus|Sonnet|Haiku|Fable|Mythos)\s+)?\d+(?:\.\d+)?\b/g,
    /\bGemini\s+\d+(?:\.\d+)?(?:\s+[A-Z][A-Za-z0-9-]+)?\b/g,
    /\bLlama\s+\d+(?:\.\d+)?\b/g,
  ];
  const modelNames = [...new Set(modelPatterns.flatMap((pattern) => text.match(pattern) || []))];
  if (modelNames.length) return modelNames.slice(0, 3);
  const introduction = text.match(/\b(?:introducing|meet|launched|releasing|announcing)\s+([A-Z][A-Za-z0-9_-]{2,})\b/i);
  const selfBuilt = text.match(/\b(?:i|we)\s+(?:just\s+)?(?:built|shipped|released|launched|open[- ]sourced|made)\s+([A-Z][A-Za-z0-9_-]{2,})\b/i);
  const capitalized = productNames(tweet);
  const primary = [introduction?.[1], selfBuilt?.[1]].find((name) => name && /^[A-Z]/.test(name) && !PRODUCT_NAME_STOP.has(name.toLowerCase()));
  return primary ? [primary] : capitalized.slice(0, 3);
}

export function versionedProductName(tweet) {
  const name = launchProductNames(tweet)[0];
  if (!name) return null;
  if (/\d/.test(name)) return name;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (tweet.text || "").match(new RegExp(`\\b${escaped}\\s+\\d+(?:\\.\\d+)+\\b`, "i"))?.[0] || null;
}

function relatesTo(builder, launch) {
  const lower = builder.text.toLowerCase();
  const versionedName = versionedProductName(launch);
  if (versionedName && !new RegExp(`\\b${versionedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`, "i").test(builder.text)) return false;
  if (launch.names.length) {
    return launch.names.some((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(builder.text));
  }
  if (launch.phrases.some((phrase) => lower.includes(phrase))) return true;
  const tokens = launch.tokens.filter((token) => token.length >= 4);
  return tokens.filter((token) => lower.includes(token)).length >= 2;
}

function relatesBuilderToLaunch(builder, launch) {
  const text = builder.text || "";
  const explicit = text.match(/\b(?:used|using|via|with|powered by|built with|made with|created with|added)\s+(?:the\s+)?@?([A-Za-z][A-Za-z0-9_.+-]*)/i) ||
    text.match(/\bbuilt\s+(?:a|an|the\s+)?@?([A-Za-z][A-Za-z0-9_.+-]*)/i);
  if (explicit) {
    const tool = explicit[1].toLowerCase();
    const filler = new Set(["a", "an", "the", "my", "our", "this", "new", "same", "app", "tool", "game", "demo", "prototype"]);
    if (!filler.has(tool)) return launch.names.some((name) => name === tool || name.startsWith(`${tool} `)) && relatesTo(builder, launch);
  }
  return relatesTo(builder, launch);
}

function titleFrom(tweet) {
  const first = tweet.text.replace(/https?:\/\/\S+/g, "").split(/\n|[!?]|\.(?!\d)/)[0].trim();
  const name = launchProductNames(tweet)[0];
  const title = name && !first.toLowerCase().includes(name.toLowerCase()) ? `${name} — ${first}` : first;
  return title.length <= 105 ? title : `${title.slice(0, 102).trim()}…`;
}

export function findFire(tweets, options = {}) {
  const now = options.now || new Date();
  const minAge = options.minAgeHours ?? 1;
  const maxAge = options.lookbackHours ?? 24;
  const rootContextHours = options.rootContextHours ?? 72;
  const maxItems = options.maxItems ?? 3;
  const launchHandles = options.launchHandles || new Set();
  const decisions = options.decisions || new Map();
  const requireDecisions = options.requireDecisions || false;

  const launches = tweets
    .filter((tweet) => {
      const age = ageHours(tweet, now);
      const decision = decisions.get(tweet.id);
      if (requireDecisions && !decision) return false;
      if (isClosedVerticalProduct(tweet)) return false;
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
        (decision.capabilityNovelty >= 1.45 ||
          (decision.capabilityNovelty >= 1.2 && heatScore(tweet, now) >= 1.75));
      const verifiedOfficialModelLaunch =
        officialLaunchAccount &&
        decision?.technologyType === "model_or_api" &&
        decision.rootLaunch >= 0.8 &&
        decision.roleConfidence >= 0.7 &&
        decision.publicAccess >= 0.75 &&
        decision.buildSurface >= 0.65;
      const product = versionedProductName(tweet) || launchProductNames(tweet)[0];
      const officialThreadAccess = officialLaunchAccount && decision?.rootLaunch >= 0.7 &&
        decision?.buildSurface >= 0.55 && reusableTechnology && product &&
        tweets.some((other) => {
          if (other.id === tweet.id || other.author?.toLowerCase() !== tweet.author.toLowerCase()) return false;
          if (Math.abs(new Date(other.createdAt) - new Date(tweet.createdAt)) > 2 * 3_600_000) return false;
          const otherDecision = decisions.get(other.id);
          if (!otherDecision || otherDecision.publicAccess < 0.75 || otherDecision.buildSurface < 0.5) return false;
          const otherProduct = versionedProductName(other) || launchProductNames(other)[0];
          return otherProduct?.toLowerCase() === product.toLowerCase();
        });
      const rulesLaunch =
        (officialLaunchAccount || selfAnnouncedPublicLaunch) &&
        LAUNCH_WORDS.test(tweet.text) &&
        LAUNCH_ACTION_WORDS.test(tweet.text) &&
        BUILDABLE_WORDS.test(tweet.text);
      return (
        tweet.author &&
        age >= minAge &&
        age <= rootContextHours &&
        !tweet.isReply &&
        (!tweet.isQuote || verifiedOfficialModelLaunch) &&
        (decision ? (semanticLaunch || officialThreadAccess || verifiedOfficialModelLaunch) : rulesLaunch) &&
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
      names: launchProductNames(tweet).map((name) => name.toLowerCase()),
    }))
    .sort((a, b) => {
      const aNovelty = a.decision?.capabilityNovelty || 0;
      const bNovelty = b.decision?.capabilityNovelty || 0;
      return b.heat * (0.85 + 0.08 * bNovelty) - a.heat * (0.85 + 0.08 * aNovelty);
    });

  const deduped = [];
  for (const launch of launches) {
    const overlaps = deduped.some((existing) => {
      const leftVersion = versionedProductName(launch)?.toLowerCase();
      const rightVersion = versionedProductName(existing)?.toLowerCase();
      if (leftVersion && rightVersion) return leftVersion === rightVersion;
      if (launch.names[0] && existing.names[0] && launch.names[0] !== existing.names[0]) return false;
      if (launch.phrases.some((phrase) => existing.phrases.includes(phrase))) return true;
      const shared = launch.tokens.filter((token) => existing.tokens.includes(token));
      const smaller = Math.max(1, Math.min(launch.tokens.length, existing.tokens.length));
      return shared.length >= 3 && shared.length / smaller >= 0.5;
    });
    if (!overlaps) deduped.push(launch);
  }

  return deduped.map((launch) => {
    const currentBuzz = tweets
      .filter((tweet) => {
        if (!tweet.author || tweet.author.toLowerCase() === launch.author.toLowerCase()) return false;
        const age = ageHours(tweet, now);
        if (age < 0 || age > maxAge || !relatesTo(tweet, launch) || heatScore(tweet, now) < 0.65) return false;
        return !requireDecisions || decisions.has(tweet.id);
      })
      .sort((a, b) => heatScore(b, now) - heatScore(a, now));
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
          hasConcreteArtifact(tweet) &&
          (FIRST_PERSON_ARTIFACT.test(tweet.text) || OWN_BUILD_WORDS.test(tweet.text));
        const rulesBuilder =
          OWN_BUILD_WORDS.test(tweet.text) || (tweet.hasMedia && BUILD_ARTIFACT_WORDS.test(tweet.text));
        return (
          age >= 0 &&
          age <= maxAge &&
          (decision ? semanticBuilder : rulesBuilder) &&
          (decision ? decision.commentary < 0.6 : !PROMOTIONAL_WORDS.test(tweet.text)) &&
          relatesBuilderToLaunch(tweet, launch)
        );
      })
      .sort((a, b) => momentum(b, now) - momentum(a, now))
      .slice(0, 3);
    return { launch, builders, currentBuzz, title: titleFrom(launch) };
  }).filter((item) => {
    if (ageHours(item.launch, now) <= maxAge) return true;
    return new Set(item.currentBuzz.map((tweet) => tweet.author.toLowerCase())).size >= 3;
  }).slice(0, maxItems);
}

const compact = (count) =>
  new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(count || 0);

function metricLine(tweet, now) {
  const m = tweet.metrics;
  const age = Math.max(0, ageHours(tweet, now));
  const metrics = [`${compact(m.likes)} likes`];
  if (m.views) metrics.push(`${compact(m.views)} views`);
  if (m.bookmarks) metrics.push(`${compact(m.bookmarks)} saves`);
  if (tweet.observed?.velocity?.likes >= 10) {
    metrics.push(`+${compact(tweet.observed.velocity.likes)} likes/h`);
  }
  return `${age.toFixed(age < 10 ? 1 : 0)}h · ${metrics.join(" · ")}`;
}

function tweetUrl(tweet) {
  return `https://x.com/${tweet.author}/status/${tweet.id}`;
}

function slackText(value) {
  return String(value).replace(/&amp;/g, "&").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function tweetLink(tweet, label) {
  return `<${tweetUrl(tweet)}|${label}>`;
}

export function formatReport(items, options = {}) {
  const now = options.now || new Date();
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam",
    day: "2-digit",
    month: "short",
  }).format(now);
  const pulse = (options.pulse || []).slice(0, 3);
  const pulseLine = pulse.length
    ? `*Pulse:* ${pulse.map((clause) => `${slackText(clause.text)}${clause.post ? ` ${tweetLink(clause.post, "post")}` : ""}`).join("; ")}.`
    : null;
  if (items.length === 0) return [`🔥 *Fire report · ${date}*`, pulseLine, "Nothing clearly catching fire in the last 24h."].filter(Boolean).join("\n");

  const lines = [`🔥 *Fire report · ${date}*`, ...(pulseLine ? [pulseLine] : []), "", "*Catching fire*"];
  for (const item of items) {
    const carryover = ageHours(item.launch, now) > 24
      ? ` · still spreading across ${new Set(item.currentBuzz.map((tweet) => tweet.author.toLowerCase())).size} hot posts today`
      : "";
    const displayTitle = item.rootUnconfirmed ? item.title : titleFrom(item.launch);
    lines.push(`• ${item.featuredModelLaunch ? "🚀 " : ""}*${slackText(displayTitle)}* — ${metricLine(item.launch, now)}${carryover} · ${tweetLink(item.launch, item.rootUnconfirmed ? "post" : "launch")}`);
    const hotRelated = (item.currentBuzz || [])
      .filter((tweet) => tweet.id !== item.launch.id && ageHours(tweet, now) <= 24)
      .sort((a, b) => (b.metrics?.likes || 0) - (a.metrics?.likes || 0))[0];
    if (hotRelated && hotRelated.metrics.likes >= 1000 &&
      hotRelated.metrics.likes >= 3 * Math.max(1, item.launch.metrics.likes)) {
      lines.push(`  ↳ ${compact(hotRelated.metrics.likes)}-like ${tweetLink(hotRelated, "related post")}`);
    }
  }

  const withBuilders = items.filter((item) => item.builders.length > 0);
  if (withBuilders.length) {
    lines.push("", "*People shipping*");
    const shownBuilderIds = new Set();
    for (const item of withBuilders) {
      for (const builder of item.builders.slice(0, 2)) {
        if (shownBuilderIds.has(builder.id)) continue;
        shownBuilderIds.add(builder.id);
        const summary = builder.text.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
        const label = launchProductNames(item.launch)[0] || item.title;
        lines.push(`• *${slackText(label)}:* ${slackText(summary.slice(0, 120))}${summary.length > 120 ? "…" : ""} · ${tweetLink(builder, "build")}`);
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
