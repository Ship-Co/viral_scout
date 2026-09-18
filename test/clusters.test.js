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

test("merges two launch posts about the same product event", () => {
  const first = post("a", "claudeai", "Projects now run from one conversation, starting in Claude Code.");
  const second = post("b", "claudedevs", "Today we're rolling out Projects in Claude Code on desktop and web.");
  const merged = mergeFireItems([
    { launch: first, title: first.text, builders: [], currentBuzz: [] },
    { launch: second, title: second.text, builders: [], currentBuzz: [] },
  ], [], 3);
  assert.equal(merged.length, 1);
});
