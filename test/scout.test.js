import test from "node:test";
import assert from "node:assert/strict";
import {
  findFire,
  formatReport,
  hasHealthyClassification,
  hasHealthyCoverage,
  selectClassificationCandidates,
} from "../src/scout.js";

const now = new Date("2026-09-11T07:00:00.000Z");
const handles = new Set(["openaidevs", "cursor_ai"]);

function tweet(overrides) {
  return {
    id: "1",
    text: "",
    author: "someone",
    createdAt: "2026-09-11T05:00:00.000Z",
    source: "fixture",
    isReply: false,
    isQuote: false,
    hasMedia: false,
    metrics: { likes: 0, reposts: 0, replies: 0, quotes: 0, bookmarks: 0, views: 0 },
    ...overrides,
  };
}

test("chooses a hot root launch and rejects its low-engagement follow-up", () => {
  const root = tweet({
    id: "root",
    author: "OpenAIDevs",
    text: "GPT-Live-1 is now available in the API for developers.",
    createdAt: "2026-09-10T11:00:00.000Z",
    metrics: { likes: 16000, reposts: 1500, replies: 500, quotes: 900, bookmarks: 9700, views: 5_400_000 },
  });
  const weakFollowup = tweet({
    id: "weak",
    author: "OpenAIDevs",
    text: "Yelp built a demo with the GPT-Live-1 API.",
    metrics: { likes: 11, reposts: 1, replies: 1, quotes: 0, bookmarks: 2, views: 2200 },
  });
  const result = findFire([root, weakFollowup], { now, launchHandles: handles });
  assert.equal(result.length, 1);
  assert.equal(result[0].launch.id, "root");
});

test("keeps launches strictly inside the 1-24h window", () => {
  const tooFresh = tweet({
    id: "fresh",
    author: "cursor_ai",
    text: "Introducing Cursor Projects, a new agent tool in public beta.",
    createdAt: "2026-09-11T06:30:00.000Z",
    metrics: { likes: 5000, reposts: 500, replies: 100, quotes: 100, bookmarks: 2000, views: 900000 },
  });
  const tooOld = { ...tooFresh, id: "old", createdAt: "2026-09-10T06:00:00.000Z" };
  assert.equal(findFire([tooFresh, tooOld], { now, launchHandles: handles }).length, 0);
});

test("only lists related shipping posts", () => {
  const launch = tweet({
    id: "launch",
    author: "cursor_ai",
    text: "Introducing Cursor Projects, a persistent coordinator and agent SDK in beta.",
    createdAt: "2026-09-10T20:00:00.000Z",
    metrics: { likes: 9000, reposts: 500, replies: 400, quotes: 300, bookmarks: 3900, views: 1_400_000 },
  });
  const related = tweet({
    id: "build",
    text: "I built a Cursor Projects demo that coordinates three coding agents.",
    author: "builder",
    hasMedia: true,
    metrics: { likes: 140, reposts: 10, replies: 8, quotes: 4, bookmarks: 50, views: 18000 },
  });
  const unrelated = tweet({ id: "other", text: "I built a weather app with another model.", author: "builder2" });
  const result = findFire([launch, related, unrelated], { now, launchHandles: handles });
  assert.deepEqual(result[0].builders.map((item) => item.id), ["build"]);
});

test("report stays concise and omits ideation", () => {
  const launch = tweet({
    id: "launch",
    author: "cursor_ai",
    text: "Introducing Cursor Projects, a persistent coordinator and agent SDK in beta.",
    createdAt: "2026-09-10T20:00:00.000Z",
    metrics: { likes: 9000, reposts: 500, replies: 400, quotes: 300, bookmarks: 3900, views: 1_400_000 },
  });
  const report = formatReport(findFire([launch], { now, launchHandles: handles }), { now });
  assert.match(report, /Catching fire/);
  assert.doesNotMatch(report, /ship.today|idea|angle/i);
  assert.ok(report.length < 1000);
});

test("keeps decimal model versions intact and shows the stronger related signal", () => {
  const launch = tweet({
    id: "root",
    author: "OpenRouter",
    text: "Grok 4.7 from SpaceXAI is live on OpenRouter!",
    metrics: { likes: 200, reposts: 20, replies: 5, quotes: 4, bookmarks: 10, views: 9000 },
  });
  const related = tweet({
    id: "reaction",
    author: "someone",
    text: "Grok 4.7 is fast and capable",
    metrics: { likes: 10000, reposts: 500, replies: 500, quotes: 200, bookmarks: 300, views: 1_000_000 },
  });
  const report = formatReport([{ launch, title: "Grok 4.7", builders: [], currentBuzz: [related] }], { now });
  assert.match(report, /Grok 4\.7 from SpaceXAI/);
  assert.match(report, /10K-like <https:\/\/x\.com\/someone\/status\/reaction\|related post>/);
});

test("keeps DocJev and Open-Jev as separate launches", () => {
  const docJev = tweet({
    id: "docjev", author: "jerryjliu0",
    text: "Introducing DocJev, an open-source document classification library using Jev.",
    metrics: { likes: 1000, reposts: 100, replies: 30, quotes: 20, bookmarks: 1400, views: 80_000 },
  });
  const openJev = tweet({
    id: "openjev", author: "Zefan_Cai",
    text: "Introducing Open-Jev, open-source decision models inspired by Jev. Code and weights are public.",
    metrics: { likes: 1000, reposts: 100, replies: 30, quotes: 20, bookmarks: 1400, views: 80_000 },
  });
  const decision = { technologyType: "open_source", rootLaunch: 0.98, publicAccess: 0.95, buildSurface: 0.85, capabilityNovelty: 2 };
  const decisions = new Map([[docJev.id, decision], [openJev.id, decision]]);
  const events = findFire([docJev, openJev], { now, decisions, requireDecisions: true });
  assert.deepEqual(new Set(events.map((event) => event.launch.id)), new Set(["docjev", "openjev"]));
});

test("a model release only uses same-version posts as buzz or builds", () => {
  const launch = tweet({
    id: "grok-47", author: "model-lab",
    text: "Grok 4.7 is now available in our API.",
    metrics: { likes: 1000, reposts: 100, replies: 20, quotes: 10, bookmarks: 100, views: 100_000 },
  });
  const older = tweet({
    id: "older", author: "older-builder", text: "I built an app with Grok 4.6.",
    metrics: { likes: 3000, reposts: 300, replies: 20, quotes: 10, bookmarks: 100, views: 100_000 },
  });
  const current = tweet({
    id: "current", author: "new-builder", text: "I built an app with Grok 4.7.",
    metrics: { likes: 250, reposts: 20, replies: 5, quotes: 2, bookmarks: 30, views: 30_000 },
  });
  const decision = { technologyType: "model_or_api", rootLaunch: 0.98, publicAccess: 0.95, buildSurface: 0.9, capabilityNovelty: 2 };
  const builder = { builderDemo: 0.95, shippedArtifact: 0.95, commentary: 0 };
  const [event] = findFire([launch, older, current], {
    now, decisions: new Map([[launch.id, decision], [older.id, builder], [current.id, builder]]), requireDecisions: true,
  });
  assert.deepEqual(event.currentBuzz.map((post) => post.id), ["current"]);
  assert.deepEqual(event.builders.map((post) => post.id), ["current"]);
});

test("keeps the maker's hot root post when a same-product thread confirms public access", () => {
  const root = tweet({
    id: "official-root", author: "SpaceXAI", text: "Grok 4.7 is here. A notable improvement over 4.6.",
    metrics: { likes: 19_000, reposts: 1000, replies: 300, quotes: 100, bookmarks: 1000, views: 2_000_000 },
  });
  const access = tweet({
    id: "official-access", author: "SpaceXAI", text: "Grok 4.7 is available now in Cursor, Grok Build, and the Grok API.",
    createdAt: "2026-09-11T05:02:00.000Z",
    metrics: { likes: 2000, reposts: 100, replies: 30, quotes: 10, bookmarks: 100, views: 100_000 },
  });
  const decisions = new Map([
    [root.id, { technologyType: "model_or_api", rootLaunch: 0.79, publicAccess: 0.36, buildSurface: 0.72, capabilityNovelty: 0.96 }],
    [access.id, { technologyType: "model_or_api", rootLaunch: 0.73, publicAccess: 0.98, buildSurface: 0.86, capabilityNovelty: 1.01 }],
  ]);
  const options = { now, decisions, launchHandles: new Set(["spacexai"]), requireDecisions: true };
  assert.equal(findFire([root], options).length, 0);
  assert.equal(findFire([root, access], options)[0].launch.id, root.id);
});

test("keeps a hot official model launch even when the announcement is a quote post", () => {
  const launch = tweet({
    id: "claude", author: "AnthropicAI", text: "Claude Opus 5.5 is available today.", isQuote: true,
    metrics: { likes: 9700, reposts: 580, replies: 335, quotes: 202, bookmarks: 549, views: 485_000 },
  });
  const decision = {
    technologyType: "model_or_api", roleConfidence: 0.78, rootLaunch: 0.83,
    publicAccess: 0.91, buildSurface: 0.81, capabilityNovelty: 0.73,
  };
  const result = findFire([launch], {
    now, decisions: new Map([[launch.id, decision]]),
    launchHandles: new Set(["anthropicai"]), requireDecisions: true,
  });
  assert.equal(result[0].launch.id, launch.id);
});

test("deduplicates first-party and product-account posts for the same named model", () => {
  const official = tweet({
    id: "openai", author: "OpenAI",
    text: "Please welcome GPT-6 Sol and GPT-6 Luna to the GPT-6 universe.",
    metrics: { likes: 4700, reposts: 670, replies: 400, quotes: 460, bookmarks: 420, views: 128_000 },
  });
  const product = tweet({
    id: "chatgpt", author: "ChatGPT",
    text: "GPT-6 Sol and GPT-6 Luna, it’s your time to shine. Rolling out today.",
    metrics: { likes: 800, reposts: 95, replies: 80, quotes: 38, bookmarks: 38, views: 18_000 },
  });
  const decision = {
    technologyType: "model_or_api", roleConfidence: 0.95, rootLaunch: 0.97,
    publicAccess: 0.82, buildSurface: 0.8, capabilityNovelty: 1.1,
  };
  const result = findFire([official, product], {
    now, decisions: new Map([[official.id, decision], [product.id, decision]]),
    launchHandles: new Set(["openai", "chatgpt"]), requireDecisions: true,
  });
  assert.deepEqual(result.map((item) => item.launch.id), [official.id]);
});

test("deduplicates a model launch and a router's same-version availability post", () => {
  const official = tweet({
    id: "official", author: "SpaceXAI", text: "Grok 4.7 is here. Available in the API.",
    metrics: { likes: 19_000, reposts: 1000, replies: 300, quotes: 100, bookmarks: 1000, views: 2_000_000 },
  });
  const router = tweet({
    id: "router", author: "OpenRouter", text: "Grok 4.7 is live on OpenRouter with public API access.",
    metrics: { likes: 200, reposts: 10, replies: 4, quotes: 2, bookmarks: 15, views: 10_000 },
  });
  const decision = { technologyType: "model_or_api", rootLaunch: 0.98, publicAccess: 0.95, buildSurface: 0.9, capabilityNovelty: 2 };
  const result = findFire([official, router], {
    now, decisions: new Map([[official.id, decision], [router.id, decision]]), requireDecisions: true,
  });
  assert.deepEqual(result.map((item) => item.launch.id), [official.id]);
});

test("does not mistake a benchmark follow-up for a root launch", () => {
  const followup = tweet({
    id: "benchmark",
    author: "OpenAIDevs",
    text: "How does GPT-Live-1 perform on benchmarks for production voice agents? Read about the API model.",
    createdAt: "2026-09-10T08:00:00.000Z",
    metrics: { likes: 900, reposts: 100, replies: 50, quotes: 30, bookmarks: 200, views: 100000 },
  });
  assert.equal(findFire([followup], { now, launchHandles: handles }).length, 0);
});

test("does not treat a closed product launch as buildable technology", () => {
  const product = tweet({
    id: "finance",
    author: "OpenAIDevs",
    text: "Now available: ChatGPT for Financial Services.",
    createdAt: "2026-09-10T08:00:00.000Z",
    metrics: { likes: 25000, reposts: 2000, replies: 500, quotes: 300, bookmarks: 10000, views: 10000000 },
  });
  assert.equal(findFire([product], { now, launchHandles: handles }).length, 0);
});

test("does not call low-signal promotional commentary a shipped build", () => {
  const launch = tweet({
    id: "live",
    author: "OpenAIDevs",
    text: "GPT-Live-1 is now available in the API.",
    createdAt: "2026-09-10T11:00:00.000Z",
    metrics: { likes: 16000, reposts: 1500, replies: 500, quotes: 900, bookmarks: 9700, views: 5_400_000 },
  });
  const promo = tweet({
    id: "promo",
    author: "employee",
    text: "Now you can build your own voice apps powered by GPT-Live-1.",
    metrics: { likes: 33, reposts: 1, replies: 2, quotes: 0, bookmarks: 1, views: 3671 },
  });
  const result = findFire([launch, promo], { now, launchHandles: handles });
  assert.equal(result[0].builders.length, 0);
});

test("does not mistake commentary about the launch company shipping for a builder project", () => {
  const launch = tweet({
    id: "agents",
    author: "OpenAIDevs",
    text: "Go from idea to a working agent faster with the Agents API, now available in public beta.",
    createdAt: "2026-09-10T11:00:00.000Z",
    metrics: { likes: 3500, reposts: 400, replies: 200, quotes: 180, bookmarks: 3700, views: 1_100_000 },
  });
  const commentary = tweet({
    id: "commentary",
    author: "commentator",
    text: "This is the AWS moment for agents. OpenAI just shipped the Agents API, and everything that made agents hard is changing.",
    hasMedia: true,
    metrics: { likes: 500, reposts: 30, replies: 20, quotes: 10, bookmarks: 100, views: 50000 },
  });
  const result = findFire([launch, commentary], { now, launchHandles: handles });
  assert.equal(result[0].builders.length, 0);
});

test("keeps distinct launches that both mention agents", () => {
  const agentsApi = tweet({
    id: "agents-api",
    author: "OpenAIDevs",
    text: "The Agents API is now available in public beta for developers.",
    createdAt: "2026-09-10T11:00:00.000Z",
    metrics: { likes: 3500, reposts: 400, replies: 200, quotes: 180, bookmarks: 3700, views: 1_100_000 },
  });
  const cursorProjects = tweet({
    id: "cursor-projects",
    author: "cursor_ai",
    text: "Introducing Projects, a new way of working in Cursor with a coordinator agent and subagents in one persistent thread.",
    createdAt: "2026-09-10T12:00:00.000Z",
    metrics: { likes: 9000, reposts: 500, replies: 400, quotes: 300, bookmarks: 3900, views: 1_400_000 },
  });
  const result = findFire([agentsApi, cursorProjects], { now, launchHandles: handles });
  assert.deepEqual(new Set(result.map((item) => item.launch.id)), new Set(["agents-api", "cursor-projects"]));
});

test("finds a high-signal self-announced model launch from the monitored feeds", () => {
  const independentLaunch = tweet({
    id: "persimmon",
    author: "humansand",
    text: "Today we're introducing Persimmon, a large-scale model and open API for simulating conversation.",
    createdAt: "2026-09-10T12:00:00.000Z",
    metrics: { likes: 1200, reposts: 150, replies: 80, quotes: 70, bookmarks: 500, views: 399000 },
  });
  const result = findFire([independentLaunch], { now, launchHandles: handles });
  assert.equal(result[0].launch.id, "persimmon");
});

test("does not treat joining an open-source foundation as a technology launch", () => {
  const membership = tweet({
    id: "foundation",
    author: "perplexitydevs",
    text: "Perplexity has joined the Rust Foundation. We support people who build reliable open-source software.",
    createdAt: "2026-09-10T12:00:00.000Z",
    metrics: { likes: 1000, reposts: 100, replies: 30, quotes: 20, bookmarks: 100, views: 150000 },
  });
  assert.equal(findFire([membership], { now, launchHandles: new Set(["perplexitydevs"]) }).length, 0);
});

test("does not surface an unknown model announcement without a public access path", () => {
  const inaccessible = tweet({
    id: "closed-model",
    author: "newlab",
    text: "Today we're introducing Persimmon, a large-scale model that simulates conversation.",
    createdAt: "2026-09-10T12:00:00.000Z",
    metrics: { likes: 1200, reposts: 150, replies: 80, quotes: 70, bookmarks: 500, views: 399000 },
  });
  assert.equal(findFire([inaccessible], { now, launchHandles: handles }).length, 0);
});

test("semantic decisions can surface an unfamiliar buildable launch without keyword matching", () => {
  const launch = tweet({
    id: "unfamiliar",
    author: "newmaker",
    text: "Meet Pollen: turn three room photos into an editable spatial scene. Try it today.",
    createdAt: "2026-09-10T12:00:00.000Z",
    metrics: { likes: 1200, reposts: 150, replies: 80, quotes: 70, bookmarks: 500, views: 399000 },
  });
  const decisions = new Map([[launch.id, {
    rootLaunch: 0.96,
    publicAccess: 0.88,
    buildSurface: 0.93,
    capabilityNovelty: 2.4,
    technologyType: "creative_tool",
  }]]);
  const result = findFire([launch], { now, launchHandles: handles, decisions });
  assert.equal(result[0].launch.id, "unfamiliar");
});

test("semantic decisions reject a viral but incremental product update", () => {
  const update = tweet({
    id: "incremental",
    author: "toolmaker",
    text: "ZCode now supports additional model providers with improved stability.",
    metrics: { likes: 1200, reposts: 150, replies: 80, quotes: 70, bookmarks: 500, views: 399000 },
  });
  const decisions = new Map([[update.id, {
    rootLaunch: 0.9,
    publicAccess: 0.9,
    buildSurface: 0.8,
    capabilityNovelty: 1.1,
    technologyType: "developer_tool",
  }]]);
  assert.equal(findFire([update], { now, minAgeHours: 0, decisions }).length, 0);
});

test("strong momentum can rescue a buildable launch just below the novelty cutoff", () => {
  const launch = tweet({
    id: "jev-gateway",
    author: "typesafeai",
    text: "Jev is now available on the Vercel AI Gateway.",
    createdAt: "2026-09-10T12:00:00.000Z",
    metrics: { likes: 2200, reposts: 150, replies: 80, quotes: 70, bookmarks: 650, views: 150000 },
  });
  const decisions = new Map([[launch.id, {
    rootLaunch: 0.98,
    publicAccess: 0.93,
    buildSurface: 0.78,
    capabilityNovelty: 1.42,
    technologyType: "model_or_api",
  }]]);
  assert.equal(findFire([launch], { now, minAgeHours: 0, decisions })[0].launch.id, launch.id);
});

test("semantic decisions reject viral commentary and accept a concrete builder demo", () => {
  const launch = tweet({
    id: "launch-semantic",
    author: "newmaker",
    text: "Pollen turns room photos into editable spatial scenes and is available today.",
    createdAt: "2026-09-10T12:00:00.000Z",
    metrics: { likes: 1200, reposts: 150, replies: 80, quotes: 70, bookmarks: 500, views: 399000 },
  });
  const demo = tweet({
    id: "demo-semantic",
    author: "maker",
    text: "My apartment became an editable spatial scene in Pollen. Here is the result.",
    hasMedia: true,
    metrics: { likes: 300, reposts: 30, replies: 20, quotes: 10, bookmarks: 100, views: 30000 },
  });
  const commentary = tweet({
    id: "comment-semantic",
    author: "pundit",
    text: "Pollen is going to change spatial computing forever.",
    metrics: { likes: 900, reposts: 100, replies: 30, quotes: 20, bookmarks: 100, views: 100000 },
  });
  const decisions = new Map([
    [launch.id, { rootLaunch: 0.98, publicAccess: 0.9, buildSurface: 0.95, capabilityNovelty: 2.4, technologyType: "creative_tool" }],
    [demo.id, { builderDemo: 0.91, shippedArtifact: 0.82, commentary: 0.04 }],
    [commentary.id, { builderDemo: 0.9, shippedArtifact: 0.9, commentary: 0.04 }],
  ]);
  const result = findFire([launch, demo, commentary], { now, launchHandles: handles, decisions });
  assert.deepEqual(result[0].builders.map((item) => item.id), ["demo-semantic"]);
});

test("the same engagement is hot when fresh and stale after most of a day", () => {
  const base = {
    author: "OpenAIDevs",
    text: "Astra Tools API is now available for developers.",
    metrics: { likes: 100, reposts: 2, replies: 3, quotes: 1, bookmarks: 8, views: 5000 },
  };
  const fresh = tweet({ ...base, id: "fresh-heat", createdAt: "2026-09-11T06:50:00.000Z" });
  const stale = tweet({ ...base, id: "stale-heat", createdAt: "2026-09-10T11:00:00.000Z" });
  assert.equal(findFire([fresh], { now, minAgeHours: 0, launchHandles: handles }).length, 1);
  assert.equal(findFire([stale], { now, minAgeHours: 0, launchHandles: handles }).length, 0);
});

test("direct-account rate limits do not block a report with healthy feed coverage", () => {
  const tweets = Array.from({ length: 300 }, (_, index) => ({ id: String(index) }));
  const errors = ["account:openai: Error 429", "account:anthropicai: Error 429"];
  assert.equal(hasHealthyCoverage(tweets, errors, { "for-you": 100, following: 200 }), true);
  assert.equal(hasHealthyCoverage(tweets, ["following: Error 429", "for-you: Error 429", "list:1: Error 429"], { following: 200 }), false);
});

test("partial Jev coverage fails closed", () => {
  assert.equal(hasHealthyClassification({ disabled: false, classified: 950 }, 1000), true);
  assert.equal(hasHealthyClassification({ disabled: false, classified: 949 }, 1000), false);
  assert.equal(hasHealthyClassification({ disabled: true, classified: 0 }, 1000), false);

  const launch = tweet({
    id: "missing-decision",
    author: "OpenAIDevs",
    text: "Astra API is now available for developers.",
    metrics: { likes: 5000, reposts: 500, replies: 100, quotes: 100, bookmarks: 2000, views: 900000 },
  });
  assert.equal(findFire([launch], { now, launchHandles: handles, requireDecisions: true }).length, 0);
});

test("classification candidates include hot technology and builder posts but skip ordinary noise", () => {
  const candidates = selectClassificationCandidates([
    tweet({
      id: "tech",
      text: "Introducing a new spatial model API.",
      metrics: { likes: 100, reposts: 2, replies: 3, quotes: 1, bookmarks: 8, views: 5000 },
      createdAt: "2026-09-11T06:50:00.000Z",
    }),
    tweet({
      id: "builder",
      text: "I built a tiny voice agent demo with Nova.",
      metrics: { likes: 5, reposts: 0, replies: 0, quotes: 0, bookmarks: 1, views: 200 },
    }),
    tweet({ id: "noise", text: "Having coffee this morning." }),
  ], { now, launchHandles: handles });
  assert.deepEqual(new Set(candidates.map((item) => item.id)), new Set(["tech", "builder"]));
});

test("keeps an older root launch when independent momentum and builds are fresh", () => {
  const root = tweet({
    id: "jev-root",
    author: "typesafeai",
    text: "We are officially out of stealth. Get access to Jev on our website.",
    createdAt: "2026-09-09T09:00:00.000Z",
    metrics: { likes: 3200, reposts: 170, replies: 130, quotes: 80, bookmarks: 940, views: 437000 },
  });
  const buzz = ["a", "b", "c"].map((author, index) => tweet({
    id: `jev-buzz-${author}`,
    author,
    text: `Jev is a major new primitive for fast AI decisions ${index}`,
    createdAt: "2026-09-11T03:00:00.000Z",
    metrics: { likes: 500, reposts: 30, replies: 20, quotes: 10, bookmarks: 100, views: 50000 },
  }));
  const build = tweet({
    id: "jev-build",
    author: "builder",
    text: "I built a Jev Doom demo where every enemy makes its own decisions.",
    createdAt: "2026-09-11T02:00:00.000Z",
    hasMedia: true,
    metrics: { likes: 4, reposts: 0, replies: 0, quotes: 0, bookmarks: 0, views: 300 },
  });
  const decisions = new Map([
    [root.id, { rootLaunch: 0.98, publicAccess: 0.9, buildSurface: 0.9, capabilityNovelty: 2.8, technologyType: "model_or_api" }],
    ...buzz.map((post) => [post.id, { commentary: 0.9 }]),
    [build.id, { builderDemo: 0.95, shippedArtifact: 0.9, commentary: 0.02 }],
  ]);
  const result = findFire([root, ...buzz, build], {
    now,
    minAgeHours: 0,
    lookbackHours: 24,
    rootContextHours: 72,
    launchHandles: new Set(["typesafeai"]),
    decisions,
    requireDecisions: true,
  });
  assert.equal(result[0].launch.id, "jev-root");
  assert.equal(result[0].currentBuzz.length, 3);
  assert.deepEqual(result[0].builders.map((post) => post.id), ["jev-build"]);
});

test("does not attach a different Claude Code build to Claude Projects", () => {
  const launch = tweet({
    id: "projects",
    author: "ClaudeDevs",
    text: "Today we're rolling out Projects in Claude Code on desktop and web.",
    metrics: { likes: 4000, reposts: 200, replies: 100, quotes: 80, bookmarks: 1300, views: 270000 },
  });
  const unrelated = tweet({
    id: "voice-mode",
    author: "builder",
    text: "I built voice mode for Claude Code so I can keep coding on a walk.",
    hasMedia: true,
    metrics: { likes: 1000, reposts: 50, replies: 30, quotes: 10, bookmarks: 300, views: 60000 },
  });
  const decisions = new Map([
    [launch.id, { rootLaunch: 1, publicAccess: 0.9, buildSurface: 0.7, capabilityNovelty: 2, technologyType: "developer_tool" }],
    [unrelated.id, { builderDemo: 1, shippedArtifact: 1, commentary: 0 }],
  ]);
  const result = findFire([launch, unrelated], { now, minAgeHours: 0, decisions, requireDecisions: true });
  assert.equal(result[0].builders.length, 0);
});

test("does not attach a Jev build to Gemini just because the benchmark compares Gemini", () => {
  const launch = tweet({
    id: "gemini",
    author: "GoogleAI",
    text: "We're updating Gemini managed agents with a new harness and public API.",
    metrics: { likes: 2000, reposts: 200, replies: 80, quotes: 70, bookmarks: 500, views: 200000 },
  });
  const build = tweet({
    id: "jev-build",
    author: "builder",
    text: "I used Jev to classify 1,018 papers, then compared the same run with Gemini Flash.",
    hasMedia: true,
  });
  const decisions = new Map([
    [launch.id, { rootLaunch: 0.95, publicAccess: 0.9, buildSurface: 0.8, capabilityNovelty: 2, technologyType: "developer_tool" }],
    [build.id, { builderDemo: 0.95, shippedArtifact: 0.9, commentary: 0.05 }],
  ]);
  const [item] = findFire([launch, build], { now, minAgeHours: 0, decisions });
  assert.equal(item.builders.length, 0);
});

test("rejects a closed vertical partner launch even when semantic scoring calls it buildable", () => {
  const launch = tweet({
    id: "astra-law",
    author: "harvey",
    text: "Harvey is proud to support the launch of Astra for Law, powered by an API.",
    metrics: { likes: 1000, reposts: 100, replies: 30, quotes: 20, bookmarks: 200, views: 100000 },
  });
  const decisions = new Map([[launch.id, {
    rootLaunch: 0.95,
    publicAccess: 0.9,
    buildSurface: 0.9,
    capabilityNovelty: 2.2,
    technologyType: "developer_tool",
  }]]);
  assert.equal(findFire([launch], { now, minAgeHours: 0, decisions }).length, 0);
});

test("does not call general experimentation a shipped artifact", () => {
  const launch = tweet({
    id: "jev",
    author: "typesafeai",
    text: "Jev is now available as a public model API.",
    metrics: { likes: 2000, reposts: 200, replies: 50, quotes: 40, bookmarks: 500, views: 150000 },
  });
  const reaction = tweet({
    id: "playing",
    author: "builder",
    text: "I have been playing with Jev. So many new apps are possible.",
    hasMedia: true,
  });
  const decisions = new Map([
    [launch.id, { rootLaunch: 0.95, publicAccess: 0.9, buildSurface: 0.9, capabilityNovelty: 2, technologyType: "model_or_api" }],
    [reaction.id, { builderDemo: 0.9, shippedArtifact: 0.9, commentary: 0.05 }],
  ]);
  const [item] = findFire([launch, reaction], { now, minAgeHours: 0, decisions });
  assert.equal(item.builders.length, 0);
});
