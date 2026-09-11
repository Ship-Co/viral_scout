const X_GRAPHQL_BASE = "https://x.com/i/api/graphql";
const WEB_BEARER_TOKEN =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

const FEATURES = {
  rweb_video_screen_enabled: false,
  rweb_cashtags_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
  creator_subscriptions_tweet_preview_api_enabled: true,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  rweb_cashtags_composer_attachment_enabled: true,
  responsive_web_jetfuel_frame: true,
  rweb_sports_post_context_enabled: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  tweetypie_unmention_optimization_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  rweb_conversational_replies_downvote_enabled: false,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  responsive_web_grok_show_grok_translated_post: true,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

const FIELD_TOGGLES = {
  withPayments: false,
  withAuxiliaryUserLabels: false,
  withArticleRichContentState: false,
  withArticlePlainText: false,
  withArticleSummaryText: false,
  withArticleVoiceOver: false,
  withGrokAnalyze: false,
  withDisallowedReplyControls: false,
};

function headers() {
  const authToken = process.env.X_AUTH_TOKEN;
  const ct0 = process.env.X_CT0;
  if (!authToken || !ct0) {
    throw new Error("Missing X_AUTH_TOKEN or X_CT0. Copy both cookies from the burner X account.");
  }
  return {
    authorization: `Bearer ${WEB_BEARER_TOKEN}`,
    "x-csrf-token": ct0,
    cookie: `auth_token=${authToken}; ct0=${ct0}`,
    "content-type": "application/json",
    "x-twitter-active-user": "yes",
    "x-twitter-auth-type": "OAuth2Session",
    "x-twitter-client-language": "en",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/145 Safari/537.36",
  };
}

async function graphql(operation, queryId, variables) {
  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(FEATURES),
    fieldToggles: JSON.stringify(FIELD_TOGGLES),
  });
  const response = await fetch(`${X_GRAPHQL_BASE}/${queryId}/${operation}?${params}`, {
    headers: headers(),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${operation} failed (${response.status}): ${body.slice(0, 180)}`);
  }
  return response.json();
}

function unwrapTweet(result) {
  if (result?.tweet?.legacy) return result.tweet;
  return result;
}

export function parseTweetEntry(entry, source = "unknown") {
  const result = unwrapTweet(entry?.content?.itemContent?.tweet_results?.result);
  const legacy = result?.legacy;
  if (!legacy?.full_text || legacy.retweeted_status_result) return null;

  const user = result?.core?.user_results?.result;
  const author = user?.core?.screen_name || user?.legacy?.screen_name;
  const media = legacy.extended_entities?.media || legacy.entities?.media || [];
  const views = Number(result?.views?.count || result?.view_count_info?.count || 0);

  return {
    id: result.rest_id || entry.entryId?.replace(/^tweet-/, "") || "",
    text: legacy.full_text,
    author,
    createdAt: legacy.created_at,
    source,
    isReply: Boolean(legacy.in_reply_to_status_id_str),
    isQuote: Boolean(legacy.is_quote_status),
    hasMedia: media.length > 0,
    metrics: {
      likes: legacy.favorite_count || 0,
      reposts: legacy.retweet_count || 0,
      replies: legacy.reply_count || 0,
      quotes: legacy.quote_count || 0,
      bookmarks: legacy.bookmark_count || 0,
      views,
    },
  };
}

function instructionsFrom(data, endpoint) {
  if (endpoint === "ListLatestTweetsTimeline") {
    return data?.data?.list?.tweets_timeline?.timeline?.instructions || [];
  }
  return data?.data?.home?.home_timeline_urt?.instructions || [];
}

function tweetsFromInstructions(instructions, source) {
  const tweets = [];
  for (const instruction of instructions) {
    const entries = instruction.entries || (instruction.entry ? [instruction.entry] : []);
    for (const entry of entries) {
      const direct = parseTweetEntry(entry, source);
      if (direct) tweets.push(direct);
      const moduleItems = entry?.content?.items || [];
      for (const moduleItem of moduleItems) {
        const nested = parseTweetEntry({ content: moduleItem.item }, source);
        if (nested) tweets.push(nested);
      }
    }
    for (const moduleItem of instruction.moduleItems || []) {
      const nested = parseTweetEntry({ content: moduleItem.item }, source);
      if (nested) tweets.push(nested);
    }
  }
  return tweets;
}

async function fetchUserTimeline(handle, cutoff) {
  const userQueryId = process.env.X_USER_QUERY_ID || "KybxDj9RrADIITXlGG8kpw";
  const tweetsQueryId = process.env.X_USER_TWEETS_QUERY_ID || "OeFjWKHutsuyWXZGmLr02A";
  const userData = await graphql("UserByScreenName", userQueryId, {
    screen_name: handle,
    withSafetyModeUserFields: true,
  });
  const userId = userData?.data?.user?.result?.rest_id;
  if (!userId) throw new Error(`Could not resolve @${handle}`);

  const timelineData = await graphql("UserTweets", tweetsQueryId, {
    userId,
    count: 20,
    includePromotedContent: false,
    withQuickPromoteEligibilityTweetFields: true,
    withVoice: true,
    withV2Timeline: true,
  });
  const instructions = timelineData?.data?.user?.result?.timeline_v2?.timeline?.instructions || [];
  return tweetsFromInstructions(instructions, `account:${handle}`).filter((tweet) => {
    const created = new Date(tweet.createdAt || 0).getTime();
    return !created || created >= cutoff;
  });
}

async function fetchTimeline({ endpoint, queryId, variables, source, maxPages, cutoff }) {
  const collected = [];
  const seen = new Set();
  let cursor = null;
  let oldPages = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const pageVariables = { ...variables, ...(cursor ? { cursor } : {}) };
    const params = new URLSearchParams({
      variables: JSON.stringify(pageVariables),
      features: JSON.stringify(FEATURES),
      fieldToggles: JSON.stringify(FIELD_TOGGLES),
    });
    const url = `${X_GRAPHQL_BASE}/${queryId}/${endpoint}?${params}`;
    const response = await fetch(url, { headers: headers() });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${endpoint} failed (${response.status}): ${body.slice(0, 180)}`);
    }

    const data = await response.json();
    const instructions = instructionsFrom(data, endpoint);
    const entries = instructions.flatMap((instruction) => instruction.entries || []);
    let nextCursor = null;
    let freshCount = 0;

    for (const entry of entries) {
      if (entry.entryId?.startsWith("cursor-bottom")) {
        nextCursor = entry.content?.value || null;
        continue;
      }
      const tweet = parseTweetEntry(entry, source);
      if (!tweet?.id || seen.has(tweet.id)) continue;
      seen.add(tweet.id);
      const created = new Date(tweet.createdAt || 0).getTime();
      if (created && created < cutoff) continue;
      collected.push(tweet);
      freshCount += 1;
    }

    oldPages = freshCount === 0 ? oldPages + 1 : 0;
    if (oldPages >= 2 || !nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }
  return collected;
}

export async function fetchAllTweets({ listIds, launchHandles, directHandles, lookbackHours }) {
  const cutoff = Date.now() - lookbackHours * 60 * 60 * 1000;
  const listQueryId = process.env.X_LIST_QUERY_ID || "u6PUF1835XGBkf6MQZUV8A";
  const homeQueryId = process.env.X_HOME_QUERY_ID || "nn16KxqX3E1OdE7WlHB5LA";
  const followingQueryId = process.env.X_FOLLOWING_QUERY_ID || "Odyc0iCUHiGTk7LkJLGvyQ";

  const jobs = [
    ...[...(directHandles || [])].map((handle) => fetchUserTimeline(handle, cutoff)),
    ...listIds.map((listId, index) =>
      fetchTimeline({
        endpoint: "ListLatestTweetsTimeline",
        queryId: listQueryId,
        variables: { listId, count: 100 },
        source: `list:${listId}`,
        maxPages: index === 0 ? 4 : 2,
        cutoff,
      })
    ),
    fetchTimeline({
      endpoint: "HomeTimeline",
      queryId: homeQueryId,
      variables: { count: 100, includePromotedContent: false },
      source: "for-you",
      maxPages: 3,
      cutoff,
    }),
    fetchTimeline({
      endpoint: "HomeLatestTimeline",
      queryId: followingQueryId,
      variables: { count: 100, includePromotedContent: false },
      source: "following",
      maxPages: 2,
      cutoff,
    }),
  ];

  const results = await Promise.allSettled(jobs);
  const errors = results.filter((result) => result.status === "rejected").map((result) => String(result.reason));
  const tweets = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const unique = [...new Map(tweets.map((tweet) => [tweet.id, tweet])).values()];
  if (unique.length === 0 && errors.length) throw new Error(errors.join(" | "));
  return { tweets: unique, errors };
}
