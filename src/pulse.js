import { eventName } from "./attribution.js";
import { ageHours, heatScore } from "./scout.js";

const FUTURE = /\b(tomorrow|soon|imminent(?:ly)?|next week|this week|final stages)\b/i;
const TENTATIVE = /\b(rumou?rs?|reportedly|scoop|expected|may|might|could|likely|preparations|imminent)\b/i;
const MODEL = /\b(?:GPT[- ]?\d+(?:\.\d+)?|Claude\s+\d+(?:\.\d+)?|Gemini\s+\d+(?:\.\d+)?|Grok\s+\d+(?:\.\d+)?)\b/i;
const amsterdamDay = (value) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(value));

function eventClause(item, now) {
  const name = eventName(item);
  if (!name || name === "unknown launch" || name.length > 35) return null;
  const age = ageHours(item.launch, now);
  const text = item.launch.text || "";
  if (item.rootUnconfirmed) return { text: `${name} gaining attention`, post: item.launch };
  if (age >= 18) {
    const liveVelocity = (item.launch.observed?.velocity?.likes || 0) >= 10;
    const freshBuzz = new Set((item.currentBuzz || [])
      .filter((post) => ageHours(post, now) <= 8 && heatScore(post, now) >= 0.65)
      .map((post) => post.author?.toLowerCase()).filter(Boolean)).size >= 2;
    if ((item.launch.metrics?.likes || 0) >= 1000 && (liveVelocity || freshBuzz)) {
      return { text: `${name} still hot`, post: item.launch };
    }
    return age <= 24 ? { text: `${name} launched`, post: item.launch } : null;
  }
  if (/\bnew\s+(?:official\s+)?plugin\b/i.test(text) && !/\bintroducing\b/i.test(text)) {
    return { text: `${name} plugin released`, post: item.launch };
  }
  if (/\b(now available|is live|out now|available to everyone|available today)\b/i.test(text)) {
    return { text: `${name} live`, post: item.launch };
  }
  return { text: `${name} launched${amsterdamDay(item.launch.createdAt) === amsterdamDay(now) ? " today" : ""}`, post: item.launch };
}

function rumorClause(posts, now) {
  const groups = new Map();
  for (const post of posts) {
    if (ageHours(post, now) < 0 || ageHours(post, now) > 24 || !FUTURE.test(post.text || "") || !TENTATIVE.test(post.text || "")) continue;
    const model = post.text.match(MODEL)?.[0]?.replace(/\s+/, "-");
    if (!model) continue;
    const group = groups.get(model) || [];
    group.push(post);
    groups.set(model, group);
  }
  const ranked = [...groups.entries()]
    .map(([model, related]) => ({
      model,
      related,
      authors: new Set(related.map((post) => post.author?.toLowerCase()).filter(Boolean)).size,
      score: related.reduce((sum, post) => sum + Math.min(heatScore(post, now), 8), 0),
      tomorrow: related.some((post) => /\btomorrow\b/i.test(post.text) && amsterdamDay(post.createdAt) === amsterdamDay(now)),
      openAI: related.some((post) => /\bOpenAI\b/i.test(post.text)),
    }))
    .filter((group) => group.authors >= 2 && group.score >= 1.5)
    .sort((a, b) => b.score - a.score);
  const top = ranked[0];
  if (!top) return null;
  const evidence = top.tomorrow
    ? top.related.filter((post) => /\btomorrow\b/i.test(post.text) && amsterdamDay(post.createdAt) === amsterdamDay(now))
    : top.related;
  const strongest = [...evidence].sort((a, b) => heatScore(b, now) - heatScore(a, now))[0];
  return {
    model: top.model,
    text: `new ${top.openAI ? "OpenAI " : ""}${top.model} model might come out ${top.tomorrow ? "tomorrow" : "soon"} (unconfirmed)`,
    post: strongest,
  };
}

export function buildPulse({ items = [], sourceItems = [], posts = [], now = new Date() }) {
  const selectedIds = new Set(items.map((item) => item.launch.id));
  const seenNames = new Set();
  const events = [...items, ...sourceItems].flatMap((item, index) => {
    const name = eventName(item).toLowerCase();
    if (seenNames.has(name)) return [];
    seenNames.add(name);
    const clause = eventClause(item, now);
    if (!clause) return [];
    const relatedToSelected = items.some((selected) => {
      const selectedName = eventName(selected).toLowerCase();
      return name !== selectedName && selectedName.length >= 3 && name.includes(selectedName);
    });
    return [{ ...clause, inReport: selectedIds.has(item.launch.id), score: (item.featuredModelLaunch ? 100 : 0) + (index < items.length ? 12 - index * 2 : 0)
      + Math.log1p(item.launch.metrics?.likes || 0) + (relatedToSelected ? 14 : 0) }];
  }).sort((a, b) => b.score - a.score);

  const confirmedNames = [...items, ...sourceItems]
    .filter((item) => !item.rootUnconfirmed)
    .map((item) => eventName(item).toLowerCase());
  const candidateRumor = rumorClause(posts, now);
  const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const rumor = candidateRumor && !confirmedNames.some((name) =>
    normalize(name).startsWith(normalize(candidateRumor.model)))
    ? candidateRumor : null;
  const eventLimit = rumor ? 2 : 3;
  return [...events.slice(0, eventLimit), ...(rumor ? [rumor] : [])]
    .slice(0, 3)
    .map(({ text, post, inReport }) => ({ text, post: inReport ? null : post }));
}
