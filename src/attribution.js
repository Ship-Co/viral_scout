import { launchProductNames } from "./scout.js";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export function eventName(item) {
  if (item.rootUnconfirmed) return item.title?.split(" — ")[0] || item.key || "unknown launch";
  const product = launchProductNames(item.launch)[0];
  if (!product) return item.title || "unknown launch";
  const escaped = product.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const version = (item.launch.text || "").match(new RegExp(`\\b${escaped}\\s+(\\d+(?:\\.\\d+)+)\\b`, "i"))?.[1];
  return version ? `${product} ${version}` : product;
}

function explicitlyNamesEvent(post, item) {
  const name = eventName(item);
  if (!name || name === "unknown launch") return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const text = post.text || "";
  const named = new RegExp(`(?:^|[^A-Za-z0-9_-])${escaped}(?=$|[^A-Za-z0-9_-])`, "i");
  if (!named.test(text)) return false;
  const inspirationOnly = new RegExp(`\\b(?:inspired by|alternative to|competitor to)\\s+${escaped}(?=$|[^A-Za-z0-9_-])`, "i");
  const actualUse = new RegExp(`\\b(?:used?|using|with|via|powered by|built with|made with|created with)\\s+(?:the\\s+)?${escaped}(?=$|[^A-Za-z0-9_-])`, "i");
  return !inspirationOnly.test(text) || actualUse.test(text);
}

export function buildAttributionRequest(items) {
  const posts = [...new Map(items.flatMap((item) => item.builders || [])
    .map((post) => [post.id, post])).values()];
  const events = items.map((item) => ({
    name: eventName(item),
    description: (item.launch.text || item.title || "").replace(/https?:\/\/\S+/g, "").slice(0, 360),
  }));
  const criteria = {
    none: "The author did not actually use any listed launch technology to produce the artifact. Inspiration, comparison, a shared parent model, and an independently launched alternative all count as none.",
    ...Object.fromEntries(events.map((event, index) => [
      `event_${index}`,
      `The author actually used ${event.name} itself to produce the artifact. ${event.description}`,
    ])),
  };
  const questions = Object.fromEntries(posts.map((_, index) => [
    `match_${index}`,
    {
      type: "choice",
      instructions: `Which specific technology in state.events did the author actually use to make the artifact in state.posts[${index}].text? A new independent product inspired by one of them is none. A generic mention of a parent technology is not use of a child library. Choose none when unclear.`,
      criteria,
    },
  ]));
  return {
    posts,
    body: {
      state: {
        events,
        posts: posts.map((post) => ({ text: (post.text || "").slice(0, 600), author: post.author })),
      },
      model: process.env.TYPESAFE_MODEL || "jev-latest",
      questions,
    },
  };
}

export function applyAttribution(items, posts, answers) {
  const assigned = new Map();
  for (let index = 0; index < posts.length; index += 1) {
    const answer = answers[`match_${index}`];
    const eventIndex = Number(answer?.choice?.match(/^event_(\d+)$/)?.[1]);
    if (!Number.isInteger(eventIndex) || eventIndex < 0 || eventIndex >= items.length) continue;
    const probability = answer.probabilities?.[`event_${eventIndex}`] || 0;
    if (probability < 0.7 || (answer.confidence ?? 0) < 0.5 || !explicitlyNamesEvent(posts[index], items[eventIndex])) continue;
    assigned.set(posts[index].id, eventIndex);
  }
  return items.map((item, index) => ({
    ...item,
    builders: (item.builders || []).filter((post) => assigned.get(post.id) === index),
  }));
}

export async function verifyBuilderAssignments(items, options = {}) {
  const { posts, body } = buildAttributionRequest(items);
  if (posts.length === 0) return { items, checked: 0, accepted: 0, healthy: true };
  const apiKey = options.apiKey || process.env.TYPESAFE_API_KEY;
  const unavailable = () => ({
    items: items.map((item) => ({ ...item, builders: [] })),
    checked: posts.length,
    accepted: 0,
    healthy: false,
  });
  if (!apiKey) return unavailable();

  const fetchImpl = options.fetchImpl || fetch;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      });
      if (!response.ok) {
        if ((response.status === 429 || response.status === 529) && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
          continue;
        }
        throw new Error(`TypeSafe attribution failed (${response.status})`);
      }
      const result = await response.json();
      const attributed = applyAttribution(items, posts, result.answers || {});
      return {
        items: attributed,
        checked: posts.length,
        accepted: attributed.reduce((total, item) => total + item.builders.length, 0),
        healthy: true,
      };
    } catch (error) {
      if (attempt === 2) return unavailable();
      await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
    }
  }
  return unavailable();
}
