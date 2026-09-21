import test from "node:test";
import assert from "node:assert/strict";
import { buildPulse } from "../src/pulse.js";
import { formatReport } from "../src/scout.js";

const now = new Date("2026-09-21T19:00:00.000Z");
const metrics = (likes) => ({ likes, reposts: 30, replies: 10, quotes: 8, bookmarks: 50, views: likes * 100 });
const post = (id, author, text, hours, likes) => ({
  id, author, text, createdAt: new Date(now.getTime() - hours * 3_600_000).toISOString(), metrics: metrics(likes),
});
const item = (launch) => ({ launch, builders: [], currentBuzz: [], title: launch.text });

test("pulse links an off-report launch and labels future model talk as unconfirmed", () => {
  const jev = item(post("jev", "typesafeai", "Jev is now available to everyone", 22, 20000));
  jev.launch.observed = { velocity: { likes: 100 } };
  const grok = item(post("grok", "OpenRouter", "Grok 4.7 is live on OpenRouter", 2, 2000));
  const openJev = item(post("openjev", "Zefan_Cai", "Inspired by Jev, we built Open-Jev: open-source decision models with code and weights.", 4, 300));
  const rumors = [
    post("scoop", "reporter", "SCOOP: OpenAI in final stages of preparations for the launch of GPT-6 Sol, shipping imminently", 3, 2000),
    post("tomorrow", "commentator", "Rumors of GPT-6 dropping as early as tomorrow", 2, 100),
  ];
  const pulse = buildPulse({ items: [jev, grok], sourceItems: [jev, grok, openJev], posts: rumors, now });
  assert.deepEqual(pulse.map((clause) => clause.text), [
    "Jev still hot", "Open-Jev launched", "new OpenAI GPT-6 model might come out tomorrow (unconfirmed)",
  ]);
  assert.equal(pulse[1].post.id, "openjev");
  assert.equal(pulse[2].post.id, "tomorrow");
  const report = formatReport([jev, grok], { now, pulse });
  assert.match(report, /\*Pulse:\* Jev still hot; Open-Jev launched <https:\/\/x\.com\/Zefan_Cai\/status\/openjev\|post>/);
  assert.match(report, /<https:\/\/x\.com\/commentator\/status\/tomorrow\|post>/);
});

test("pulse does not invent off-report stories or repeat a single rumor", () => {
  const jev = item(post("jev", "typesafeai", "Jev is now available to everyone", 22, 20000));
  jev.launch.observed = { velocity: { likes: 100 } };
  const rumor = post("rumor", "one", "GPT-6 might launch tomorrow", 1, 1000);
  const pulse = buildPulse({ items: [jev], sourceItems: [jev], posts: [rumor], now });
  assert.deepEqual(pulse.map((clause) => clause.text), ["Jev still hot"]);
});

test("old cumulative likes alone justify launch context, not 'still hot'", () => {
  const stale = item(post("old", "lab", "Nova is now available", 22, 20000));
  assert.deepEqual(buildPulse({ items: [stale], sourceItems: [stale], now }).map((clause) => clause.text), ["Nova launched"]);
});

test("pulse does not repeat launch rumors after a confirmed root launch appears", () => {
  const launched = item(post("root", "OpenAIDevs", "GPT-6 is now available in the API", 1, 20000));
  const rumors = [
    post("a", "one", "Rumors GPT-6 launches tomorrow", 2, 2000),
    post("b", "two", "GPT-6 launch expected soon", 2, 1000),
  ];
  const pulse = buildPulse({ items: [launched], sourceItems: [launched], posts: rumors, now });
  assert.deepEqual(pulse.map((clause) => clause.text), ["GPT-6 live"]);
});

test("yesterday's 'tomorrow' rumor is not presented as tomorrow today", () => {
  const earlier = [
    post("a", "one", "Rumors GPT-6 launches tomorrow", 23, 2000),
    post("b", "two", "GPT-6 launch expected soon", 23, 1000),
  ];
  const pulse = buildPulse({ posts: earlier, now });
  assert.deepEqual(pulse.map((clause) => clause.text), ["new GPT-6 model might come out soon (unconfirmed)"]);
});
