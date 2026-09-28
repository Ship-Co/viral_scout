import test from "node:test";
import assert from "node:assert/strict";
import { isDigestWindow } from "../src/pipeline.js";

test("the full Amsterdam digest hour remains open for retries", () => {
  assert.equal(isDigestWindow(new Date("2026-09-28T18:00:00.000Z")), true);
  assert.equal(isDigestWindow(new Date("2026-09-28T18:45:00.000Z")), true);
  assert.equal(isDigestWindow(new Date("2026-09-28T19:00:00.000Z")), false);
});

test("the retry window follows Amsterdam daylight saving time", () => {
  assert.equal(isDigestWindow(new Date("2026-12-01T19:45:00.000Z")), true);
  assert.equal(isDigestWindow(new Date("2026-12-01T20:00:00.000Z")), false);
});
