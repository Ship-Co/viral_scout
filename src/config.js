const split = (value, fallback) =>
  (value === undefined ? fallback : value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

export const config = {
  listIds: split(
    process.env.X_LIST_IDS,
    "2098465457497878706,1585430245762441216,1883934942175854910,1179844739765620744,1278784207641284609,1597115448146898944,1676646159539130369,2033552221049086322"
  ),
  launchHandles: new Set(
    split(
      process.env.LAUNCH_HANDLES,
      "OpenAI,OpenAIDevs,ChatGPT,AnthropicAI,ClaudeDevs,GoogleDeepMind,GoogleAI,xai,SpaceXAI,MistralAI,huggingface,AIatMeta,cursor_ai,typesafeai,github,vercel,replit,lovable,runwayml,midjourney,perplexitydevs"
    ).map((handle) => handle.toLowerCase())
  ),
  modelLaunchHandles: new Set(
    split(
      process.env.MODEL_LAUNCH_HANDLES,
      "OpenAI,OpenAIDevs,AnthropicAI,ClaudeDevs,GoogleDeepMind,GoogleAI,xai,SpaceXAI,MistralAI,AIatMeta,typesafeai"
    ).map((handle) => handle.toLowerCase())
  ),
  directHandles: new Set(
    split(
      process.env.X_DIRECT_HANDLES,
      "OpenAI,OpenAIDevs,ChatGPT,AnthropicAI,ClaudeDevs,GoogleDeepMind,GoogleAI,xai,SpaceXAI,MistralAI,huggingface,AIatMeta,cursor_ai,typesafeai"
    ).map((handle) => handle.toLowerCase())
  ),
  lookbackHours: Number(process.env.LOOKBACK_HOURS || 24),
  rootContextHours: Number(process.env.ROOT_CONTEXT_HOURS || 72),
  minAgeHours: Number(process.env.MIN_AGE_HOURS || 0),
  maxReportItems: Number(process.env.MAX_REPORT_ITEMS || 3),
  digestHourAmsterdam: Number(process.env.DIGEST_HOUR_AMSTERDAM || 20),
  homeMaxPages: Number(process.env.X_HOME_MAX_PAGES || 50),
  followingMaxPages: Number(process.env.X_FOLLOWING_MAX_PAGES || 50),
  listMaxPages: Number(process.env.X_LIST_MAX_PAGES || 20),
  priorityListMaxPages: Number(process.env.X_PRIORITY_LIST_MAX_PAGES || 30),
};
