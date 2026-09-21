import { config } from "./config.js";
import { verifyBuilderAssignments } from "./attribution.js";
import { buildPulse } from "./pulse.js";
import { discoverEventClusters, mergeFireItems } from "./clusters.js";
import { findFire, formatReport, hasHealthyCoverage, selectClassificationCandidates } from "./scout.js";
import { sendToSlack } from "./slack.js";
import {
  decisionsFromState,
  loadState,
  mergeCollection,
  postsFromState,
  saveState,
  unseenPosts,
} from "./state.js";
import { classifyPosts } from "./typesafe.js";
import { fetchAllTweets } from "./x.js";

function collectorConfig(now) {
  const handles = [...config.directHandles];
  const partition = Math.floor(now.getUTCMinutes() / 15) % 4;
  return {
    ...config,
    directHandles: new Set(handles.filter((_, index) => index % 4 === partition)),
    lookbackHours: 8,
    homeMaxPages: 4,
    followingMaxPages: 4,
    listMaxPages: 1,
    priorityListMaxPages: 2,
  };
}

function mergeDecisionMaps(...maps) {
  return new Map(maps.flatMap((map) => [...map.entries()]));
}

export async function collectOnce(options = {}) {
  const now = options.now || new Date();
  const state = await loadState();
  const scanConfig = options.deep ? config : collectorConfig(now);
  const { tweets, errors, sourceStats } = await fetchAllTweets(scanConfig);
  const statePosts = postsFromState(state, { now, hours: config.rootContextHours });
  const hydrated = new Map(statePosts.map((post) => [post.id, post]));
  const candidates = selectClassificationCandidates(
    tweets.map((tweet) => hydrated.get(tweet.id) || tweet),
    { now, launchHandles: config.launchHandles }
  );
  const pending = unseenPosts(candidates, state);
  const classification = await classifyPosts(pending);

  mergeCollection(state, tweets, classification.decisions, now);
  await saveState(state);
  return { state, tweets, errors, sourceStats, candidates, pending, classification };
}

export function amsterdamDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isDigestWindow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return Number(parts.hour) === config.digestHourAmsterdam && Number(parts.minute) < 15;
}

export async function runDailyScout(options = {}) {
  const now = options.now || new Date();
  const send = options.send ?? true;
  const result = await collectOnce({ now, deep: true });
  const allPosts = postsFromState(result.state, { now, hours: config.rootContextHours });
  const decisions = mergeDecisionMaps(decisionsFromState(result.state), result.classification.decisions);
  const allCandidates = selectClassificationCandidates(allPosts, { now, launchHandles: config.launchHandles });
  const classifiedCount = allCandidates.filter((post) => decisions.has(post.id)).length;
  const classificationHealthy = allCandidates.length > 0 && classifiedCount / allCandidates.length >= 0.95;
  const coverageHealthy = hasHealthyCoverage(result.tweets, result.errors, result.sourceStats);

  const sourceItems = findFire(allPosts, {
    now,
    launchHandles: config.launchHandles,
    minAgeHours: config.minAgeHours,
    lookbackHours: config.lookbackHours,
    rootContextHours: config.rootContextHours,
    maxItems: 20,
    decisions,
    requireDecisions: true,
  });
  const clusterItems = discoverEventClusters(allPosts, decisions, {
    now,
    maxItems: config.maxReportItems * 2,
  });
  const candidates = mergeFireItems(sourceItems, clusterItems, config.maxReportItems, {
    now,
    modelLaunchHandles: config.modelLaunchHandles,
  });
  const attribution = await verifyBuilderAssignments(candidates);
  const items = attribution.items;
  const pulse = buildPulse({ items, sourceItems, posts: allPosts, now });
  const report = formatReport(items, { now, pulse });

  if (send && coverageHealthy && classificationHealthy) {
    await sendToSlack(report);
    result.state.lastDigestDate = amsterdamDate(now);
    await saveState(result.state);
  }

  return {
    report,
    scanned: result.tweets.length,
    remembered: allPosts.length,
    sourceFailures: result.errors.length,
    feedCoverage: {
      forYou: result.sourceStats["for-you"] || 0,
      following: result.sourceStats.following || 0,
    },
    qualifyingLaunches: items.length,
    sourceLaunches: sourceItems.length,
    rootlessClusters: clusterItems.filter((item) => item.rootUnconfirmed).length,
    jevClassifiedNow: result.classification.classified,
    jevCandidates: allCandidates.length,
    jevCoverage: classifiedCount,
    jevFailures: result.classification.failed,
    builderCandidatesChecked: attribution.checked,
    verifiedBuilders: attribution.accepted,
    builderVerificationHealthy: attribution.healthy,
    sent: send && coverageHealthy && classificationHealthy,
    coverageHealthy,
    classificationHealthy,
  };
}

export async function runTick(options = {}) {
  const now = options.now || new Date();
  const collection = await collectOnce({ now, deep: false });
  const today = amsterdamDate(now);
  if (!isDigestWindow(now) || collection.state.lastDigestDate === today) {
    return {
      collected: collection.tweets.length,
      newlyClassified: collection.classification.classified,
      sourceFailures: collection.errors.length,
      digest: false,
    };
  }
  const digest = await runDailyScout({ now, send: true });
  return { collected: collection.tweets.length, digest: true, ...digest };
}
