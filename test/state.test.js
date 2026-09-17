import test from "node:test";
import assert from "node:assert/strict";
import { mergeCollection, postsFromState } from "../src/state.js";

function post(likes, views) {
  return {
    id: "jev",
    text: "Jev is now available as a model API.",
    author: "typesafeai",
    createdAt: "2026-09-17T10:00:00.000Z",
    source: "for-you",
    metrics: { likes, views, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 },
  };
}

test("persists metric snapshots and derives observed velocity", () => {
  const state = { version: 1, posts: {} };
  mergeCollection(state, [post(100, 10_000)], new Map(), new Date("2026-09-17T10:15:00.000Z"));
  mergeCollection(state, [post(160, 25_000)], new Map(), new Date("2026-09-17T10:45:00.000Z"));
  const [remembered] = postsFromState(state, { now: new Date("2026-09-17T11:00:00.000Z"), hours: 24 });
  assert.equal(remembered.observed.delta.likes, 60);
  assert.equal(remembered.observed.velocity.likes, 120);
  assert.equal(remembered.observed.velocity.views, 30_000);
});
