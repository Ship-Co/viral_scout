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
      "OpenAI,OpenAIDevs,ChatGPT,AnthropicAI,ClaudeDevs,GoogleDeepMind,GoogleAI,xai,MistralAI,huggingface,AIatMeta,cursor_ai,github,vercel,replit,lovable,runwayml,midjourney,perplexitydevs"
    ).map((handle) => handle.toLowerCase())
  ),
  directHandles: new Set(
    split(
      process.env.X_DIRECT_HANDLES,
      "OpenAI,OpenAIDevs,ChatGPT,AnthropicAI,ClaudeDevs,GoogleDeepMind,GoogleAI,xai,MistralAI,huggingface,AIatMeta,cursor_ai"
    ).map((handle) => handle.toLowerCase())
  ),
  lookbackHours: Number(process.env.LOOKBACK_HOURS || 24),
  minAgeHours: Number(process.env.MIN_AGE_HOURS || 1),
  maxReportItems: Number(process.env.MAX_REPORT_ITEMS || 3),
  digestHourAmsterdam: Number(process.env.DIGEST_HOUR_AMSTERDAM || 18),
};
