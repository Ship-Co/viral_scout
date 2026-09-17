import test from "node:test";
import assert from "node:assert/strict";
import { userTimelineInstructions } from "../src/x.js";

const instructions = [{ type: "TimelineAddEntries" }];

test("reads current and legacy X user timeline response shapes", () => {
  assert.equal(userTimelineInstructions({
    data: { user: { result: { timeline_v2: { timeline: { instructions } } } } },
  }), instructions);
  assert.equal(userTimelineInstructions({
    data: { user: { result: { timeline: { timeline: { instructions } } } } },
  }), instructions);
  assert.equal(userTimelineInstructions({
    data: { user: { result: { timeline: { instructions } } } },
  }), instructions);
});
