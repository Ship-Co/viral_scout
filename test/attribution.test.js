import test from "node:test";
import assert from "node:assert/strict";
import { applyAttribution, buildAttributionRequest, verifyBuilderAssignments } from "../src/attribution.js";
import { launchProductNames } from "../src/scout.js";

const docJev = {
  id: "docjev-root",
  author: "jerryjliu0",
  text: "Introducing DocJev - a lightning-fast OSS library for document classification and splitting with jev.",
};
const studioTwin = {
  id: "studiotwin-root",
  author: "RealTwinStudios",
  text: "Your next game asset starts before the 3D model. Now, so does StudioTwin. Meet ConceptLab: create with AI agents via MCP.",
};
const openJev = {
  id: "open-jev",
  author: "Zefan_Cai",
  text: "Inspired by Jev, we built Open-Jev: open-source decision models. 2B/9B: LoRA adapters + decision heads.",
};
const effort = {
  id: "effort",
  author: "miu21590",
  text: "People use Jev to pick a model before a task. I made it change GPT-6's reasoning effort inside Codex DURING the task.",
};
const game = {
  id: "game",
  author: "petergostev",
  text: "Roller Coast Tycoon: Astra vs Fable, now playing via an MCP, that I built for them.",
};

test("extracts the exact child product instead of its parent model or the first sentence", () => {
  assert.deepEqual(launchProductNames(docJev), ["DocJev"]);
  assert.deepEqual(launchProductNames(studioTwin), ["ConceptLab"]);
  assert.deepEqual(launchProductNames(openJev), ["Open-Jev"]);
});

test("attribution questions distinguish the specific launch from related but separate products", () => {
  const items = [
    { launch: docJev, builders: [openJev, effort] },
    { launch: studioTwin, builders: [game] },
  ];
  const { posts, body } = buildAttributionRequest(items);
  assert.equal(posts.length, 3);
  assert.equal(body.state.events[0].name, "DocJev");
  assert.equal(body.state.events[1].name, "ConceptLab");
  assert.match(body.questions.match_0.criteria.none, /independently launched alternative/);
  const result = applyAttribution(items, posts, {
    match_0: { choice: "none", confidence: 0.9, probabilities: { none: 0.95 } },
    match_1: { choice: "none", confidence: 0.9, probabilities: { none: 0.95 } },
    match_2: { choice: "none", confidence: 0.9, probabilities: { none: 0.95 } },
  });
  assert.deepEqual(result.map((item) => item.builders), [[], []]);
});

test("retains only a confidently attributed artifact", async () => {
  const actualDocJevBuild = { id: "docjev-build", text: "I used DocJev to split 500 PDFs into sections.", author: "builder" };
  const items = [{ launch: docJev, builders: [openJev, actualDocJevBuild] }];
  const result = await verifyBuilderAssignments(items, {
    apiKey: "test-key",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ answers: {
        match_0: { choice: "none", confidence: 0.9, probabilities: { none: 0.9 } },
        match_1: { choice: "event_0", confidence: 0.9, probabilities: { event_0: 0.95 } },
      } }),
    }),
  });
  assert.deepEqual(result.items[0].builders.map((post) => post.id), ["docjev-build"]);
  assert.equal(result.accepted, 1);
});

test("rejects a confident but incorrect model match without the exact launched product", () => {
  const wrong = { choice: "event_0", confidence: 0.99, probabilities: { event_0: 0.99 } };
  const items = [{ launch: docJev, builders: [openJev, effort] }];
  const { posts } = buildAttributionRequest(items);
  const result = applyAttribution(items, posts, { match_0: wrong, match_1: wrong });
  assert.deepEqual(result[0].builders, []);
});

test("requires the specific model version for versioned launch builds", () => {
  const root = { text: "Grok 4.7 is live on OpenRouter", author: "OpenRouter" };
  const older = { id: "older", text: "I built an app with Grok 4.6", author: "builder" };
  const current = { id: "current", text: "I built an app with Grok 4.7", author: "builder2" };
  const items = [{ launch: root, builders: [older, current] }];
  const { posts, body } = buildAttributionRequest(items);
  assert.equal(body.state.events[0].name, "Grok 4.7");
  const positive = { choice: "event_0", confidence: 0.99, probabilities: { event_0: 0.99 } };
  const result = applyAttribution(items, posts, { match_0: positive, match_1: positive });
  assert.deepEqual(result[0].builders.map((post) => post.id), ["current"]);
});

test("does not call an independent Jev alternative a Jev build even if the model does", () => {
  const jev = { text: "Jev is now available to everyone", author: "typesafeai" };
  const items = [{ launch: jev, builders: [openJev] }];
  const { posts } = buildAttributionRequest(items);
  const positive = { choice: "event_0", confidence: 0.99, probabilities: { event_0: 0.99 } };
  assert.deepEqual(applyAttribution(items, posts, { match_0: positive })[0].builders, []);
});

test("omits uncertain builder links when the attribution service fails", async () => {
  const result = await verifyBuilderAssignments([{ launch: docJev, builders: [openJev] }], {
    apiKey: "test-key",
    fetchImpl: async () => { throw new Error("offline"); },
  });
  assert.deepEqual(result.items[0].builders, []);
  assert.equal(result.healthy, false);
});
