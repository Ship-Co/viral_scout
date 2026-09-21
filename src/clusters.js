import { ageHours, hasConcreteArtifact, heatScore, launchProductNames, momentum } from "./scout.js";

const STOP = new Set(`
  about after again against all also and any are because been before being between both but can could did does
  doing down during each few for from further had has have having her here hers herself him himself his how
  into its itself just more most our ours ourselves out over own same she should some such than that the their
  theirs them themselves then there these they this those through too under until very was were what when where
  which while who whom why will with you your yours yourself yourselves today introducing launch launched now
  available release released new model models api sdk agent agents tool tools build built building using use ai
  llm demo video image code post thread first make made people really like one get got lets just open source
  openai anthropic google claude chatgpt cursor xai meta microsoft github vercel
  agents agent code projects pro super live release gateway today rolling world excited available
`.trim().split(/\s+/));

function terms(post) {
  const found = [];
  for (const match of (post.text || "").matchAll(/[@#]?([A-Za-z][A-Za-z0-9]*(?:[_.+-][A-Za-z0-9]+)*)/g)) {
    const raw = match[1];
    const term = raw.toLowerCase();
    if (term.length < 3 || STOP.has(term) || term === "t.co" || term === post.author?.toLowerCase() || /^https?$/.test(term)) continue;
    const distinctive = /[A-Z]/.test(raw.slice(1)) || /\d|[_.+-]/.test(raw) || match[0].startsWith("@") || match[0].startsWith("#");
    if (distinctive || raw[0] === raw[0].toUpperCase()) found.push({ term, label: raw });
  }
  return [...new Map(found.map((item) => [item.term, item])).values()].slice(0, 10);
}

function decisionIsRelevant(post, decision) {
  const text = post.text || "";
  const vertical = /\bfor\s+(law|legal|financial services|finance|healthcare|government|enterprise)\b/i.test(text);
  const partnerAnnouncement = /\b(proud|excited|thrilled)\b.{0,80}\b(support|partner|collaborat|launch)\b/i.test(text);
  const closedVertical = vertical && (partnerAnnouncement ||
    !/\b(api|sdk|cli|open[- ]source|github|plugin|mcp|weights|repository)\b/i.test(text));
  if (closedVertical) return false;
  return decision && (
    decision.rootLaunch >= 0.45 ||
    decision.builderDemo >= 0.5 ||
    decision.buildSurface >= 0.55 ||
    decision.publicAccess >= 0.7
  );
}

function chooseRoot(posts, decisions, now, term) {
  const roots = posts.filter((post) => {
    const decision = decisions.get(post.id);
    return !post.isQuote && !post.isReply &&
      decision?.rootLaunch >= 0.82 &&
      decision?.roleConfidence >= 0.7 &&
      decision?.publicAccess >= 0.5 &&
      launchProductNames(post).some((name) => name.toLowerCase() === term) &&
      ageHours(post, now) <= 72;
  });
  return roots.sort((a, b) => heatScore(b, now) - heatScore(a, now))[0] || null;
}

function titleFromPost(post) {
  const first = (post.text || "").replace(/https?:\/\/\S+/g, "").split(/\n|[!?]|\.(?!\d)/)[0].trim();
  return first.length <= 105 ? first : `${first.slice(0, 102).trim()}…`;
}

function namedRootlessEvent(bucket, posts) {
  const label = [...bucket.labels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || bucket.term;
  const distinctive = /[A-Z]/.test(label.slice(1)) || /\d|[-_.+]/.test(label);
  const version = posts.map((post) => (post.text || "").match(
    new RegExp(`\\b${bucket.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(\\d+(?:\\.\\d+)+)\\b`, "i")
  )?.[1]).find(Boolean);
  const announced = posts.some((post) => {
    const text = post.text || "";
    const named = bucket.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b(?:introducing|meet|launch(?:ed|ing)?|releas(?:ed|ing)?|now available|open[- ]sourced)\\b.{0,45}\\b${named}\\b`, "i").test(text);
  });
  if (!distinctive && !version && !announced) return null;
  return version ? `${label} ${version}` : label;
}

export function discoverEventClusters(posts, decisions, options = {}) {
  const now = options.now || new Date();
  const maxItems = options.maxItems ?? 5;
  const buckets = new Map();

  for (const post of posts) {
    const decision = decisions.get(post.id);
    if (!post.author || !decisionIsRelevant(post, decision) || ageHours(post, now) > 72) continue;
    for (const { term, label } of terms(post)) {
      const bucket = buckets.get(term) || { term, labels: new Map(), posts: new Map() };
      bucket.labels.set(label, (bucket.labels.get(label) || 0) + 1);
      bucket.posts.set(post.id, post);
      buckets.set(term, bucket);
    }
  }

  const candidates = [];
  for (const bucket of buckets.values()) {
    const clusterPosts = [...bucket.posts.values()];
    const fresh = clusterPosts.filter((post) => ageHours(post, now) <= 24);
    const authors = new Set(fresh.map((post) => post.author.toLowerCase()));
    const hot = fresh.filter((post) => heatScore(post, now) >= 0.65);
    const builders = fresh.filter((post) => {
      const decision = decisions.get(post.id);
      return decision?.builderDemo >= 0.55 && decision?.shippedArtifact >= 0.58 && hasConcreteArtifact(post);
    });
    const buildable = clusterPosts.filter((post) => {
      const decision = decisions.get(post.id);
      return decision?.buildSurface >= 0.55 && decision?.publicAccess >= 0.5;
    });
    const root = chooseRoot(clusterPosts, decisions, now, bucket.term);
    const rootlessName = root ? null : namedRootlessEvent(bucket, fresh);
    const aggregateHeat = hot.reduce((sum, post) => sum + Math.min(heatScore(post, now), 8), 0);

    const enoughIndependentSignal = root
      ? authors.size >= 2 && hot.length >= 1
      : authors.size >= 4 && hot.length >= 2;
    if (!enoughIndependentSignal || buildable.length === 0 || aggregateHeat < 1.5 || (!root && !rootlessName)) continue;

    const representative = root || [...fresh].sort((a, b) => heatScore(b, now) - heatScore(a, now))[0];
    candidates.push({
      key: bucket.term,
      title: root ? titleFromPost(root) : `${rootlessName} — emerging buildable tech (root launch unconfirmed)`,
      launch: representative,
      builders: builders.filter((post) => post.id !== representative.id)
        .sort((a, b) => momentum(b, now) - momentum(a, now)).slice(0, 3),
      currentBuzz: fresh.filter((post) => post.id !== representative.id)
        .sort((a, b) => heatScore(b, now) - heatScore(a, now)),
      clusterPosts: fresh,
      rootUnconfirmed: !root,
      clusterScore: aggregateHeat + authors.size + builders.length * 2 + (root ? 3 : 0),
    });
  }

  const selected = [];
  for (const candidate of candidates.sort((a, b) => b.clusterScore - a.clusterScore)) {
    const ids = new Set(candidate.clusterPosts.map((post) => post.id));
    if (selected.some((item) => item.clusterPosts.filter((post) => ids.has(post.id)).length >= 2)) continue;
    selected.push(candidate);
    if (selected.length >= maxItems) break;
  }
  return selected;
}

export function mergeFireItems(sourceItems, clusterItems, maxItems = 3) {
  const dedupeStop = new Set("today introducing launch launched available release released rolling from with into starting now this that have your".split(" "));
  const eventTokens = (item) => new Set(((item.title || item.launch.text || "").toLowerCase().match(/[a-z0-9][a-z0-9+_.-]{3,}/g) || [])
    .filter((token) => !dedupeStop.has(token)));
  const overlaps = (left, right) => {
    if (left.launch.id === right.launch.id) return true;
    const leftName = launchProductNames(left.launch)[0]?.toLowerCase();
    const rightName = launchProductNames(right.launch)[0]?.toLowerCase();
    if (leftName && rightName && leftName !== rightName) return false;
    if (left.clusterPosts?.some((post) => post.id === right.launch.id)) return true;
    if (right.clusterPosts?.some((post) => post.id === left.launch.id)) return true;
    const a = eventTokens(left);
    const b = eventTokens(right);
    const shared = [...a].filter((token) => b.has(token)).length;
    return shared >= 3 || (shared >= 2 && shared / Math.max(1, Math.min(a.size, b.size)) >= 0.4);
  };

  const merged = [];
  for (const candidate of [...sourceItems, ...clusterItems]) {
    const existing = merged.find((item) => overlaps(item, candidate));
    if (!existing) {
      merged.push(candidate);
      continue;
    }
    existing.builders = [...new Map([...(existing.builders || []), ...(candidate.builders || [])]
      .map((post) => [post.id, post])).values()].slice(0, 3);
    existing.currentBuzz = [...new Map([...(existing.currentBuzz || []), ...(candidate.currentBuzz || [])]
      .map((post) => [post.id, post])).values()];
    existing.clusterScore = Math.max(existing.clusterScore || 0, candidate.clusterScore || 0);
  }
  return merged
    .sort((a, b) => (b.clusterScore || heatScore(b.launch)) - (a.clusterScore || heatScore(a.launch)))
    .slice(0, maxItems);
}
