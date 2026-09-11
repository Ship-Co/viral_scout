import test from "node:test";
import assert from "node:assert/strict";
import { findFire, formatReport } from "../src/scout.js";

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
