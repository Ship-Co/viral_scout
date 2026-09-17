import test from "node:test";
import assert from "node:assert/strict";
import { classifyPosts, evaluatePost } from "../src/typesafe.js";

test("normalizes Jev's typed answers into scout signals", async () => {
  const fetchImpl = async (_url, request) => {
    const body = JSON.parse(request.body);
    assert.equal(body.model, "jev-latest");
    assert.equal(body.state.posts[0].text, "A new build surface");
    return new Response(JSON.stringify({
      model: "jev-1.13.0",
      answers: {
        "0_event_role": { type: "choice", choice: "root_launch", confidence: 0.9, probabilities: { root_launch: 0.92, builder_demo: 0.02, followup: 0.02, commentary: 0.03, other: 0.01 } },
        "0_technology_type": { type: "choice", choice: "model_or_api", confidence: 0.8, probabilities: { model_or_api: 0.9 } },
        "0_public_access": { type: "noul", noul: 0.88 },
        "0_build_surface": { type: "noul", noul: 0.94 },
        "0_shipped_artifact": { type: "noul", noul: 0.1 },
        "0_capability_novelty": { type: "score", score: 2.4, confidence: 0.7, probabilities: {}, legend: {} },
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

test("batches several posts into one Jev request", async () => {
  let calls = 0;
  const fetchImpl = async (_url, request) => {
    calls += 1;
    const body = JSON.parse(request.body);
    assert.equal(body.state.posts.length, 2);
    assert.match(body.questions["1_event_role"].instructions.question, /posts\[1\]\.text/);
    const answers = {};
    for (let index = 0; index < 2; index += 1) {
      answers[`${index}_event_role`] = {
        type: "choice",
        choice: index === 0 ? "root_launch" : "commentary",
        confidence: 1,
        probabilities: { root_launch: index === 0 ? 1 : 0, commentary: index === 1 ? 1 : 0 },
      };
      answers[`${index}_technology_type`] = {
        type: "choice",
        choice: "developer_tool",
        confidence: 1,
        probabilities: { developer_tool: 1 },
      };
      answers[`${index}_public_access`] = { type: "noul", noul: 0.9 };
      answers[`${index}_build_surface`] = { type: "noul", noul: 0.8 };
      answers[`${index}_shipped_artifact`] = { type: "noul", noul: 0.1 };
      answers[`${index}_capability_novelty`] = { type: "score", score: 2, confidence: 1 };
    }
    return new Response(JSON.stringify({
      model: "jev-1.13.0",
      answers,
      usage: { input_tokens: 900, output_tokens: 150 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const result = await classifyPosts([
    { id: "a", text: "Launch" },
    { id: "b", text: "Reaction" },
  ], { apiKey: "test", fetchImpl, batchSize: 8, concurrency: 1 });
  assert.equal(calls, 1);
  assert.equal(result.classified, 2);
  assert.equal(result.decisions.get("a").rootLaunch, 1);
  assert.equal(result.decisions.get("b").commentary, 1);
  assert.equal(result.inputTokens, 900);
});
