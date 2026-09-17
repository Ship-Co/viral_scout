import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePost } from "../src/typesafe.js";

test("normalizes Jev's typed answers into scout signals", async () => {
  const fetchImpl = async (_url, request) => {
    const body = JSON.parse(request.body);
    assert.equal(body.model, "jev-latest");
    assert.equal(body.state.post.text, "A new build surface");
    return new Response(JSON.stringify({
      model: "jev-1.13.0",
      answers: {
        event_role: { type: "choice", choice: "root_launch", confidence: 0.9, probabilities: { root_launch: 0.92, builder_demo: 0.02, followup: 0.02, commentary: 0.03, other: 0.01 } },
        technology_type: { type: "choice", choice: "model_or_api", confidence: 0.8, probabilities: { model_or_api: 0.9 } },
        public_access: { type: "noul", noul: 0.88 },
        build_surface: { type: "noul", noul: 0.94 },
        shipped_artifact: { type: "noul", noul: 0.1 },
        capability_novelty: { type: "score", score: 2.4, confidence: 0.7, probabilities: {}, legend: {} },
      },
      usage: { input_tokens: 500, output_tokens: 100 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const decision = await evaluatePost({ id: "1", text: "A new build surface" }, { apiKey: "test", fetchImpl });
  assert.equal(decision.model, "jev-1.13.0");
  assert.equal(decision.rootLaunch, 0.92);
  assert.equal(decision.publicAccess, 0.88);
  assert.equal(decision.capabilityNovelty, 2.4);
  assert.equal(decision.usage.input_tokens, 500);
});
