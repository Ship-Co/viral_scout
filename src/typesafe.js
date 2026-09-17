const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export const VIRAL_SCOUT_QUESTIONS = {
  event_role: {
    type: "choice",
    instructions: {
      question: "What role does `post.text` play in a technology event?",
      focus: "Judge what this specific post is doing, not how exciting the subject sounds.",
    },
    criteria: {
      root_launch: {
        what: "The maker or project announces a specific new technology or newly available capability",
        not_for: "Follow-up examples, benchmarks, customer stories, commentary, or restating someone else's news",
      },
      builder_demo: {
        what: "An independent builder shows or reports a working artifact they made using a named technology",
        not_for: "Ideas, tutorials without an artifact, predictions, or saying what people could build",
      },
      followup: {
        what: "An update, example, benchmark, tutorial, customer story, or case study about an existing launch",
        not_for: "The original availability announcement or an independent shipped artifact",
      },
      commentary: {
        what: "Opinion, analysis, reaction, news repetition, prediction, or promotion without a new working artifact",
        not_for: "A first-party root launch or a demonstrated independent build",
      },
      other: "Unrelated to a concrete technology launch or build",
    },
  },
  technology_type: {
    type: "choice",
    instructions: "What is the main thing described in `post.text`?",
    criteria: {
      model_or_api: "An AI model, API, inference service, or new programmable capability",
      developer_tool: "An SDK, CLI, coding agent, plugin, MCP server, framework, or developer platform",
      creative_tool: "Technology for generating or editing images, video, audio, 3D, games, or other media",
      open_source: "Code, model weights, dataset, or technical project released for public use",
      research: "Research result or paper without a usable public implementation or access path",
      closed_product: "A finished end-user product or feature without a surface developers can build on",
      non_technology: "None of these",
    },
  },
  public_access: {
    type: "noul",
    instructions: "Does `post.text` say or strongly indicate that developers or creators can access and use this technology now?",
    criteria: {
      true: "Available API, SDK, model, weights, repository, plugin, CLI, public beta, download, or generally available tool",
      false: "Research only, teaser, waitlist, private demo, future promise, closed product, or no access path",
    },
  },
  build_surface: {
    type: "noul",
    instructions: "Is the technology in `post.text` a meaningful surface on which people can build applications, workflows, integrations, or creative artifacts?",
    criteria: {
      true: "It exposes a reusable capability that can produce many distinct downstream builds",
      false: "It is mainly news, a minor feature, a finished vertical product, or has no practical downstream build surface",
    },
  },
  shipped_artifact: {
    type: "noul",
    instructions: "Does `post.text` provide evidence that its author actually built, tested, or shipped a working artifact?",
    criteria: {
      true: "The author describes a concrete result, demo, prototype, integration, app, workflow, or output they made",
      false: "The post only suggests possibilities, promotes the technology, comments on it, or repeats news",
    },
  },
  capability_novelty: {
    type: "score",
    instructions: "How novel and consequential is the technical capability described in `post.text`, based only on the text?",
    criteria: [
      "No concrete new technical capability",
      "Routine update or incremental improvement",
      "Meaningful new capability or access that enables useful new builds",
      "Major capability shift that enables builds which were previously impractical",
    ],
  },
};

function retryDelay(response, attempt) {
  const seconds = Number(response.headers.get("retry-after"));
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1_000, 10_000);
  return Math.min(250 * 2 ** attempt, 4_000);
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function pointAtPost(value, index) {
  if (typeof value === "string") return value.replaceAll("`post.", `\`posts[${index}].`);
  if (Array.isArray(value)) return value.map((item) => pointAtPost(item, index));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, pointAtPost(item, index)]));
  }
  return value;
}

function normalizeDecision(answers, model, usage, index) {
  const answer = (name) => answers[`${index}_${name}`] || {};
  const role = answer("event_role");
  const type = answer("technology_type");
  return {
    model,
    role: role.choice || "other",
    roleConfidence: role.confidence || 0,
    rootLaunch: role.probabilities?.root_launch || 0,
    builderDemo: role.probabilities?.builder_demo || 0,
    followup: role.probabilities?.followup || 0,
    commentary: role.probabilities?.commentary || 0,
    technologyType: type.choice || "non_technology",
    technologyTypeConfidence: type.confidence || 0,
    publicAccess: answer("public_access").noul || 0,
    buildSurface: answer("build_surface").noul || 0,
    shippedArtifact: answer("shipped_artifact").noul || 0,
    capabilityNovelty: answer("capability_novelty").score || 0,
    usage,
  };
}

export async function evaluatePostBatch(posts, options = {}) {
  const apiKey = options.apiKey || process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new Error("Missing TYPESAFE_API_KEY");
  if (posts.length === 0) return [];
  const fetchImpl = options.fetchImpl || fetch;
  const model = options.model || process.env.TYPESAFE_MODEL || "jev-latest";
  const maxAttempts = options.maxAttempts ?? 3;
  const state = {
    posts: posts.map((post) => ({
      text: post.text,
      author: post.author || null,
      is_reply: Boolean(post.isReply),
      is_quote: Boolean(post.isQuote),
      has_media: Boolean(post.hasMedia),
    })),
  };
  const questions = {};
  for (let index = 0; index < posts.length; index += 1) {
    for (const [name, question] of Object.entries(VIRAL_SCOUT_QUESTIONS)) {
      questions[`${index}_${name}`] = pointAtPost(question, index);
    }
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ state, model, questions }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });

    if (response.ok) {
      const body = await response.json();
      const answers = body.answers || {};
      const usage = body.usage || { input_tokens: 0, output_tokens: 0 };
      return posts.map((_, index) => normalizeDecision(answers, body.model || model, usage, index));
    }

    const retryable = response.status === 429 || response.status === 529;
    const message = (await response.text()).slice(0, 240);
    if (!retryable || attempt === maxAttempts - 1) {
      throw new Error(`TypeSafe evaluation failed (${response.status}): ${message}`);
    }
    await wait(retryDelay(response, attempt));
  }
  throw new Error("TypeSafe evaluation failed");
}

export async function evaluatePost(post, options = {}) {
  const [decision] = await evaluatePostBatch([post], options);
  return decision;
}

export async function classifyPosts(posts, options = {}) {
  const apiKey = options.apiKey || process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    return { decisions: new Map(), classified: 0, failed: 0, inputTokens: 0, disabled: true };
  }

  const decisions = new Map();
  const failures = [];
  let cursor = 0;
  let inputTokens = 0;
  const batchSize = Math.max(1, Math.min(Number(options.batchSize || process.env.TYPESAFE_BATCH_SIZE || 8), 16));
  const concurrency = Math.max(1, Math.min(Number(options.concurrency || process.env.TYPESAFE_CONCURRENCY || 12), 24));
  const batches = [];
  for (let index = 0; index < posts.length; index += batchSize) batches.push(posts.slice(index, index + batchSize));

  async function worker() {
    while (cursor < batches.length) {
      const index = cursor;
      cursor += 1;
      const batch = batches[index];
      try {
        const batchDecisions = await evaluatePostBatch(batch, options);
        batch.forEach((post, postIndex) => decisions.set(post.id, batchDecisions[postIndex]));
        inputTokens += batchDecisions[0]?.usage.input_tokens || 0;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(...batch.map((post) => ({ id: post.id, error: message })));
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, () => worker()));
  return {
    decisions,
    classified: decisions.size,
    failed: failures.length,
    failures,
    inputTokens,
    disabled: false,
  };
}
