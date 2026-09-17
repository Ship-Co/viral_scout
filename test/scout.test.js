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
