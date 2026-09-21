import test from "node:test";
import assert from "node:assert/strict";
import { discoverEventClusters, mergeFireItems } from "../src/clusters.js";

const now = new Date("2026-09-17T12:00:00.000Z");
const metrics = { likes: 300, reposts: 30, replies: 10, quotes: 8, bookmarks: 100, views: 40_000 };

function post(id, author, text) {
  return { id, author, text, createdAt: "2026-09-17T10:00:00.000Z", metrics, hasMedia: true };
}

test("discovers a buildable event from independent posts without a known launch account", () => {
  const posts = [
    post("a", "one", "I built a game with Pollen3D and shipped the demo."),
    post("b", "two", "Pollen3D turns three photos into an editable scene. I tested the API."),
    post("c", "three", "My Pollen3D room reconstruction prototype is live."),
    post("d", "four", "Pollen3D might be the fastest spatial model this week."),
  ];
  const decisions = new Map(posts.map((item, index) => [item.id, {
    rootLaunch: 0.1,
    publicAccess: index === 1 ? 0.9 : 0.4,
    buildSurface: 0.85,
    builderDemo: index < 3 ? 0.9 : 0.1,
    shippedArtifact: index < 3 ? 0.9 : 0.1,
  }]));
  const [cluster] = discoverEventClusters(posts, decisions, { now });
  assert.equal(cluster.key, "pollen3d");
  assert.equal(cluster.rootUnconfirmed, true);
  assert.equal(cluster.builders.length, 1);
});

test("does not invent a Codex launch from posts that only mention the existing platform", () => {
  const posts = [
    post("a", "one", "Jev makes Codex agent evaluations cheaper. I built a memory layer."),
    post("b", "two", "I used Codex to vibe code a game this morning."),
    post("c", "three", "Codex developers are talking about agent memory today."),
    post("d", "four", "Here is my Codex game prototype and demo."),
  ];
  const decisions = new Map(posts.map((item) => [item.id, {
    rootLaunch: 0.1,
    publicAccess: 0.9,
    buildSurface: 0.9,
    builderDemo: 0.9,
    shippedArtifact: 0.9,
  }]));
  assert.equal(discoverEventClusters(posts, decisions, { now }).some((cluster) => cluster.key === "codex"), false);
});

test("keeps a versioned model event found without an official root post", () => {
  const posts = [
    post("a", "one", "Grok 4.7 is out with lower latency and a public API."),
    post("b", "two", "I built a voice app with Grok 4.7 today."),
    post("c", "three", "Grok 4.7 model tests are spreading fast."),
    post("d", "four", "Our Grok 4.7 integration is live."),
  ];
  const decisions = new Map(posts.map((item) => [item.id, {
    rootLaunch: 0.1,
    publicAccess: 0.9,
    buildSurface: 0.9,
    builderDemo: 0.9,
    shippedArtifact: 0.9,
  }]));
  const cluster = discoverEventClusters(posts, decisions, { now }).find((item) => item.key === "grok 4.7");
  assert.match(cluster.title, /Grok 4\.7/);
});

test("does not promote a quoted reaction into the root launch", () => {
  const posts = [
    { ...post("a", "one", "Excited to bring 4.7 to you all! Grok Build is incredibly capable."), isQuote: true },
    post("b", "two", "Grok 4.7 is now available in Grok Build."),
    post("c", "three", "My first Grok 4.7 app is live."),
    post("d", "four", "Testing Grok 4.7 in the public API."),
    post("e", "five", "Our Grok 4.7 integration is live."),
  ];
  const decisions = new Map(posts.map((item) => [item.id, {
    rootLaunch: item.id === "a" ? 0.98 : 0.1,
    roleConfidence: 0.95,
    publicAccess: 0.9,
    buildSurface: 0.9,
    builderDemo: 0.8,
    shippedArtifact: 0.8,
  }]));
  const cluster = discoverEventClusters(posts, decisions, { now }).find((item) => item.key === "grok 4.7");
  assert.equal(cluster.rootUnconfirmed, true);
  assert.match(cluster.title, /Grok 4\.7/);
});

test("does not combine independent posts about different versions into one event", () => {
  const posts = ["4.7", "4.6"].flatMap((version) => [
    post(`${version}-a`, `one-${version}`, `Grok ${version} is live in the public API.`),
    post(`${version}-b`, `two-${version}`, `I built a demo with Grok ${version}.`),
    post(`${version}-c`, `three-${version}`, `Testing Grok ${version} today.`),
    post(`${version}-d`, `four-${version}`, `Our Grok ${version} integration is live.`),
  ]);
  const decisions = new Map(posts.map((item) => [item.id, {
    rootLaunch: 0.1, publicAccess: 0.9, buildSurface: 0.9, builderDemo: 0.8, shippedArtifact: 0.8,
  }]));
  const clusters = discoverEventClusters(posts, decisions, { now });
  assert.deepEqual(new Set(clusters.map((item) => item.key)), new Set(["grok 4.7", "grok 4.6"]));
  for (const cluster of clusters) {
    assert.ok(cluster.clusterPosts.every((item) => item.text.includes(cluster.key.replace("grok", "Grok"))));
  }
});

test("merges two launch posts about the same product event", () => {
  const first = post("a", "claudeai", "Projects now run from one conversation, starting in Claude Code.");
  const second = post("b", "claudedevs", "Today we're rolling out Projects in Claude Code on desktop and web.");
  const merged = mergeFireItems([
    { launch: first, title: first.text, builders: [], currentBuzz: [] },
    { launch: second, title: second.text, builders: [], currentBuzz: [] },
  ], [], 3);
  assert.equal(merged.length, 1);
});
